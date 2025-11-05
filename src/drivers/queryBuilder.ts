import { QueryResult } from "mysql2";
import { DeleteQueryBuilder, InsertQueryBuilder, ObjectLiteral, QueryFailedError, Repository, SelectQueryBuilder, UpdateQueryBuilder } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { stackTrace } from "../core";
import { PartialConditions, QueryAction, QueryError, SelectQueryResult } from "../types";
import ZormExprBuilder from "./expressionBuilder";
import { MySQLErrorMap } from "./mysql/index.js";

class ZormQueryBuilder<T extends ObjectLiteral, R = QueryResult> extends Promise<R> {
    private repository: Repository<T>;
    private queryBuilder: SelectQueryBuilder<T> | UpdateQueryBuilder<T> | InsertQueryBuilder<ObjectLiteral> | DeleteQueryBuilder<T>;
    private entityAlias: string;
    private action: QueryAction;
    private queryValues: QueryDeepPartialEntity<T> | QueryDeepPartialEntity<T[] | null> = null;
    private usePromise: boolean;
    private whereCount: number = 0;
    private isActiveRecord: boolean = false;
    private activeRecord : T | null
    private joinedAliases: Record<string, string> = {};
    // private currentWhereLogic: 'AND' | 'OR' = 'AND';

    constructor(repository: Repository<T>, _action: QueryAction, _usePromise?: boolean) {
        super(() => {}); // Required for extending Promise
        this.repository = repository;
        this.entityAlias = repository.metadata.tableName;
        this.queryBuilder = repository.createQueryBuilder(this.entityAlias);
        this.action = _action
        this.usePromise = _usePromise || false;
        this.activeRecord =  null

        // switch (_action) {
        //     case "create":
        //     case "upsert":
        //         this.queryBuilder = repository.createQueryBuilder(this.entityAlias) as InsertQueryBuilder<ObjectLiteral>;
        //         break;
        //     case "update":
        //         this.queryBuilder = repository.createQueryBuilder(this.entityAlias).update() as UpdateQueryBuilder<T>;
        //         break;
        //     case "delete":
        //         this.queryBuilder = repository.createQueryBuilder(this.entityAlias).delete() as DeleteQueryBuilder<T>;
        //         break;
        //     case "select":
        //     default:
        //         this.queryBuilder = repository.createQueryBuilder(this.entityAlias) as SelectQueryBuilder<T>;
        //         break;
        // }
    }

    _create(): this {
        if ( this.queryValues ) {
            this.queryBuilder = this.queryBuilder
                .insert()
                .into(this.entityAlias)
                .values(this.queryValues!) as InsertQueryBuilder<ObjectLiteral>;
        }
        else throw stackTrace(`○ Values are missing. You forgot to call .with({ key: value })`);
        return this;
    }

    upsert(): this {
        
        if ( this.queryValues ) {
            this.queryBuilder = this.repository.createQueryBuilder(this.entityAlias)
                .insert()
                .into(this.entityAlias)
                .values(this.queryValues!)
                .orUpdate(Object.keys(this.queryValues));
        }
        else throw stackTrace(`○ Values are missing. You forgot to call .with({ key: value })`)
        return this;
    }

    _update(): this {
        if ( this.queryValues ) {
            if ( this.whereCount > 0 ){    
                this.queryBuilder = this.queryBuilder
                    .update()
                    .set(this.queryValues as Partial<T>) as UpdateQueryBuilder<T>;
            }
            else {
                throw stackTrace(`○ Update must have at least one WHERE condition. You forgot to call .where({ condition: value })`);
            }
        }
        else throw stackTrace(`○ Values are missing. You forgot to call .with({ key: value })`);
        return this;
    }

    _delete(): this {

        if ( this.whereCount > 0 ){    
            this.queryBuilder = this.queryBuilder.delete() as DeleteQueryBuilder<T>
        }
        else {
            throw stackTrace(`○ Delete must have at least one WHERE condition. You forgot to call .where({ condition: value })`);
        }
        
        return this;
    }

    _getRawQuery(){
        return this.queryBuilder.getQueryAndParameters()
    }

    active(){
        this.isActiveRecord = true
        return this
    }

    async _saveActiveRecord(activeRecord: T): Promise<T | null> {
        
        // if (!this.activeRecord) throw new Error("No active record found. Use `findOne` first.");
        
        return this.repository.save(activeRecord);
        // return this
    }

    clone(): ZormQueryBuilder<T, R> {
        const cloned = new ZormQueryBuilder<T, R>(this.repository, this.action, this.usePromise);

        cloned.queryBuilder = this.queryBuilder.clone(); // Deep clone of query builder
        cloned.entityAlias = this.entityAlias;
        cloned.queryValues = this.queryValues ? structuredClone(this.queryValues) : null;
        cloned.whereCount = this.whereCount;
        cloned.isActiveRecord = this.isActiveRecord;
        cloned.activeRecord = this.activeRecord;

        return cloned;
    }

    /**
     * Sets the values for an insert or update query.
     * @param data - The data to be inserted or updated.
     * @returns The current instance of ZormQueryBuilder.
     */
    with(data: QueryDeepPartialEntity<T> | QueryDeepPartialEntity<T[]>): this {
        this.queryValues = data
        return this
    }

    /**
     * Sets the values for an insert or update query.
     * @param data - The data to be inserted or updated.
     * @returns The current instance of ZormQueryBuilder.
     */
    withData(data: QueryDeepPartialEntity<T> | QueryDeepPartialEntity<T[]>): this {
        this.queryValues = data
        return this
    }

    /**
     * Specifies the fields to be selected in a select query.
     * @param fields - The fields to be selected.
     * @returns The current instance of ZormQueryBuilder.
     */
    select(fields: (keyof T)[]): this {
        (this.queryBuilder as SelectQueryBuilder<T>)
            .select(fields.map(field => `${this.entityAlias}.${String(field)}`)) ;
        return this;
    }
    
    private applyCondition(
        qb: SelectQueryBuilder<T> | UpdateQueryBuilder<T> | DeleteQueryBuilder<T>,
        condition: PartialConditions<T>,
        type: "andWhere" | "orWhere"
    ): void {
        Object.entries(condition).forEach(([key, value], index) => {

            const paramKey = `${key}Param${index}_${this.whereCount}`; // Unique parameter name

            let sqlOperator = "="; // Default to "="
            
            if (typeof value === "string") {
                const match = value.match(/^(!=|>=|<=|>|<|=)\s*(.+)$/); // Improved regex
                if (match) {
                    const [, operator, rawValue] = match;
                    sqlOperator = operator; // Directly use the matched operator
                    const parsedValue = !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue.trim(); // Convert to number if possible

                    qb[type](`${qb.alias}.${key} ${sqlOperator} :${paramKey}`, { [paramKey]: parsedValue });
                    return;
                }
            }
            else if (typeof value === "object" && value !== null) {
                // Support object-based conditions: { age: { gt: 18, lt: 20 } }
                const operators: Record<string, string> = {
                    gt: ">",
                    gte: ">=",
                    lt: "<",
                    lte: "<=",
                    ne: "!=",
                    eq: "="
                };
    
                Object.entries(value).forEach(([opKey, opValue]) => {
                    if (operators[opKey]) {
                        const paramKey = `${key}Param_${opKey}_${this.whereCount++}`; // Unique param key
                        qb[type](`${qb.alias}.${key} ${operators[opKey]} :${paramKey}`, { [paramKey]: opValue });
                    }
                });
    
                return; // Prevent default equality case for objects
            }

            // Default case (normal equality condition)
            qb[type](`${this.entityAlias}.${key} = :${paramKey}`, { [paramKey]: value });
            this.whereCount++

        });
    }  
    
    /**
     * Adds a custom expression-based WHERE clause using a fluent builder.
     * @param fn - A callback that receives a ZormExprBuilder and returns an expression + param.
     */
    expression(exprFn: (
        q: ZormExprBuilder<T>) => ZormExprBuilder<T>,
        /** Add parentheses group to built expression */
        group: boolean = true
    ): this {
        
        const qb = this.queryBuilder as SelectQueryBuilder<T> | UpdateQueryBuilder<T>;
        const result = exprFn(new ZormExprBuilder<T>(this.entityAlias));
        const _expression = result.buildExpression()
        qb.andWhere(group ? `(${_expression})` : _expression, result.buildParams());

        this.whereCount++;
        return this;
    }

    // expression(exprFn: (q: ZormExprBuilder<T>) => ZormExprBuilder<T>): this {
        
    //     const qb = this.queryBuilder as SelectQueryBuilder<T> | UpdateQueryBuilder<T>;
    //     const result = exprFn(new ZormExprBuilder<T>(this.entityAlias));

    //     // const expression = 

    //     qb.andWhere(result.buildExpression(), result.buildParams());
    //     // if ('expression' in result && 'param' in result) {
    //     // } else {
    //     //     // fallback if only expression was built without .equals()
    //     // }
    //     // qb.andWhere(result.buildExpression(), result.buildParams());

    //     this.whereCount++;
    //     return this;
    // }


    /**
     * Adds a WHERE condition to the query.
     * @param condition - The condition to be added.
     * @returns The current instance of ZormQueryBuilder.
     */
    where(condition: PartialConditions<T>): this {
        const qb = this.queryBuilder as SelectQueryBuilder<T> | UpdateQueryBuilder<T>;
        this.applyCondition(qb, condition, `andWhere`)
        return this;
    }
    
    /**
     * Adds an OR condition to the query.
     * @param condition - The condition to be added.
     * @returns The current instance of ZormQueryBuilder.
     */
    or(condition: PartialConditions<T>): this {
        const qb = (this.queryBuilder as  SelectQueryBuilder<T> | UpdateQueryBuilder<T> | DeleteQueryBuilder<T>)
        this.applyCondition(qb, condition, `orWhere`)
        return this;
    }

    /**
     * Adds an ORDER BY clause to the query.
     * @param field - The field to order by.
     * @param direction - The direction of the order (ASC or DESC).
     * @returns The current instance of ZormQueryBuilder.
     */
    orderBy(field: keyof T, direction: "ASC" | "DESC" = "ASC"): this {
        (this.queryBuilder as  SelectQueryBuilder<T> | UpdateQueryBuilder<T>).orderBy(`${this.entityAlias}.${String(field)}`, direction);
        return this;
    }

    /**
     * Adds a LIMIT clause to the query.
     * @param n - The maximum number of records to return.
     * @returns The current instance of ZormQueryBuilder.
     */
    limit(n: number): this {
        (this.queryBuilder as  SelectQueryBuilder<T> | UpdateQueryBuilder<T>).limit(n);
        return this;
    }

    /**
     * Adds an OFFSET clause to the query.
     * @param n - The number of records to skip.
     * @returns The current instance of ZormQueryBuilder.
     */
    offset(n: number): this {
        (this.queryBuilder as  SelectQueryBuilder<T>).offset(n);
        return this;
    }

    /**
     * Adds relations to be included in the query.
     * @param relations - The relations to be included.
     * @returns The current instance of ZormQueryBuilder.
     */
    withRelation(rel : string, ...more: string[]): this {
        [ rel, ...more ].forEach(relation => (this.queryBuilder as  SelectQueryBuilder<T>).leftJoinAndSelect(`${this.entityAlias}.${relation}`, relation));
        return this;
    }

    /**
     * Adds an INNER JOIN clause to the query.
     * @param relation - The relation to join.
     * @param alias - The alias for the joined relation.
     * @param condition - Optional condition for the join.
     * @returns The current instance of ZormQueryBuilder.
     */
    innerJoin(relation: string, alias: string, condition?: string): this {
        if (condition) {
            (this.queryBuilder as  SelectQueryBuilder<T>).innerJoin(`${this.entityAlias}.${relation}`, alias, condition);
        } else {
            (this.queryBuilder as  SelectQueryBuilder<T>).innerJoin(`${this.entityAlias}.${relation}`, alias);
        }
        this.joinedAliases[alias] = relation;
        return this;
    }

    /**
     * Adds a LEFT JOIN clause to the query.
     * @param relation - The relation to join.
     * @param alias - The alias for the joined relation.
     * @param condition - Optional condition for the join.
     * @returns The current instance of ZormQueryBuilder.
     */
    leftJoin(relation: string, alias: string, condition?: string): this {
        if (condition) {
            (this.queryBuilder as  SelectQueryBuilder<T>).leftJoin(`${this.entityAlias}.${relation}`, alias, condition);
        } else {
            (this.queryBuilder as  SelectQueryBuilder<T>).leftJoin(`${this.entityAlias}.${relation}`, alias);
        }
        this.joinedAliases[alias] = relation;
        return this;
    }

    /**
     * Adds a GROUP BY clause to the query.
     * @param field - The field to group by.
     * @returns The current instance of ZormQueryBuilder.
     */
    groupBy(field: keyof T): this {
        (this.queryBuilder as  SelectQueryBuilder<T>).groupBy(`${this.entityAlias}.${String(field)}`);
        return this;
    }

    /**
     * Adds a HAVING clause to the query.
     * @param condition - The condition for the HAVING clause.
     * @returns The current instance of ZormQueryBuilder.
     */
    having(condition: string): this {
        (this.queryBuilder as  SelectQueryBuilder<T>).having(condition);
        return this;
    }

    /**
     * Adds an IN clause to the query.
     * @param field - The field to check.
     * @param values - The values for the IN clause.
     * @returns The current instance of ZormQueryBuilder.
     */
    in(field: keyof T, values: any[]): this {
        (this.queryBuilder as  SelectQueryBuilder<T> | UpdateQueryBuilder<T> | DeleteQueryBuilder<T>).andWhere(`${this.entityAlias}.${String(field)} IN (:...values)`, { values });
        this.whereCount++
        return this;
    }

    /**
     * Adds a LIKE condition to the query, supporting both single and multiple values.
     * If an array is provided, it uses OR conditions between them.
     * @param field - The field to apply the LIKE condition on.
     * @param value - A string or an array of strings to match.
     * @returns The current instance of ZormQueryBuilder.
     */
    like(
        conditions: Partial<Record<keyof T, string | string[]>>,
        mode: "contains" | "startsWith" | "endsWith" | "exact"
    ): this {
        if (!conditions || Object.keys(conditions).length === 0) return this;

        const qb = this.queryBuilder as SelectQueryBuilder<T> | UpdateQueryBuilder<T>;
        const orConditions: string[] = [];
        const params: Record<string, string> = {};

        Object.entries(conditions).forEach(([field, value]) => {
            const values = Array.isArray(value) ? value : [value];
            const fieldConditions: string[] = [];

            values.forEach((val, index) => {
                const paramKey = `${field}LikeParam${index}_${this.whereCount}`;
                fieldConditions.push(`${this.entityAlias}.${String(field)} LIKE :${paramKey}`);

                let formattedVal = val;
                switch (mode || "contains") {
                    case "startsWith":
                        formattedVal = `${val}%`;
                        break;
                    case "endsWith":
                        formattedVal = `%${val}`;
                        break;
                    case "exact":
                        formattedVal = `${val}`;
                        break;
                    case "contains":
                    default:
                        formattedVal = `%${val}%`;
                }

                params[paramKey] = formattedVal; // Directly use the value (supports %xyz% pattern)
            });

            if (fieldConditions.length > 0) {
                orConditions.push(`(${fieldConditions.join(" OR ")})`);
            }
        });

        if (orConditions.length > 0) {
            qb.andWhere(`(${orConditions.join(" OR ")})`, params);
            this.whereCount++;
        }

        return this;
    }    


    /**
     * Adds a DISTINCT clause to the query.
     * @returns The current instance of ZormQueryBuilder.
     */
    distinct(): this {
        (this.queryBuilder as  SelectQueryBuilder<T>).distinct(true);
        return this;
    }

    async count(field?: keyof T): Promise<number> {
        if (field) {
            (this.queryBuilder as  SelectQueryBuilder<T>).select(`COUNT(${field as string})`);
        }
        return await (this.queryBuilder as  SelectQueryBuilder<T>).getCount();
    }

    async sum(field: keyof T): Promise<number> {
        const result = await this.queryBuilder!.select(`SUM(${this.entityAlias}.${String(field)})`, "sum").getRawOne();
        return result.sum || 0;
    }

    async avg(field: keyof T): Promise<number> {
        const result = await this.queryBuilder!.select(`AVG(${this.entityAlias}.${String(field)})`, "avg").getRawOne();
        return result.avg || 0;
    }

    async min(field: keyof T): Promise<number> {
        const result = await this.queryBuilder!.select(`MIN(${this.entityAlias}.${String(field)})`, "min").getRawOne();
        return result.min || 0;
    }

    async max(field: keyof T): Promise<number> {
        const result = await this.queryBuilder!.select(`MAX(${this.entityAlias}.${String(field)})`, "max").getRawOne();
        return result.max || 0;
    }

    /**
     * Executes a raw SQL query.
     * @param sql - The raw SQL query.
     * @param params - Optional parameters for the query.
     * @returns A promise that resolves with the query result.
     */
    async rawQuery(sql: string, params?: any): Promise<any> {
        return await this.repository.query(sql, params);
    }

    /**
     * Executes the query and returns the result.
     * @returns A promise that resolves with the query result.
     */
    async execute(): Promise<R> {

        const removedMethods: Record<string, any> = {};
        Object.keys(Object.prototype).forEach((method) => {
            if (Object.prototype.hasOwnProperty.call(Object.prototype, method!)) {
                removedMethods[method!] = (Object.prototype as any)[method!];
                delete (Object.prototype as any)[method!];
            }
        });

        try{
            switch (this.action) {
                case "upsert":
                case "create":
                    this._create()
                    const _create = await (this.queryBuilder as InsertQueryBuilder<T>).execute()
                    return <R>{ 
                        created: true, 
                        id: _create.raw.insertId, 
                        record: _create.generatedMaps[0], 
                        records: _create.generatedMaps.length > 1 ? _create.generatedMaps : null
                    }
                case "update":
                    this._update()
                    const _updateQuery = this.queryBuilder as UpdateQueryBuilder<T>
                    const _update = await _updateQuery.execute()
                    const whereQuery = _updateQuery.getQuery().split("WHERE")[1]?.trim(); // Get the WHERE clause
                    const _get = this.repository
                            .createQueryBuilder(this.entityAlias)
                            .where(whereQuery, _updateQuery.getParameters()); // Use the same parameters
                    // console.log(_updateQuery.getQueryAndParameters())
                    const _updated = await _get.getMany()
                    return <R>{ 
                        updated: _update.affected ? _update.affected > 0 : false, 
                        record: _updated[0],
                        records: _updated.length > 1 ? _updated : []
                    }
                case "delete":
                    this._delete()
                    const _delete = await (this.queryBuilder as DeleteQueryBuilder<T>).execute()
                    return <R>{ 
                        deleted: _delete.affected ? _delete.affected > 0 : false, 
                        count: _delete.affected || 0 }
                case "select":
                default:
                    const _select = await (this.queryBuilder as SelectQueryBuilder<T>).getMany()
                    
                    const _result : SelectQueryResult = {
                        hasRows: _select.length > 0,
                        count: _select.length,
                        row: _select.length > 0 ? _select[0] : null,
                        rows: _select.length == 1 ? [_select[0]] : _select,
                    }

                    if ( this.isActiveRecord ){
                        _result.save = () => this._saveActiveRecord(_select[0])
                    }
                    
                    return _result as R
            }

        } catch (err) {
            const _e = err as QueryFailedError
            const error = <QueryError>{
                code: MySQLErrorMap[(_e as any).code] || (_e as any).code,
                message: _e.message,
                query: _e.query, // The SQL query that caused the error
                values: _e.parameters, // Parameters used in the query
            }
            switch (this.action) {
                case "upsert":
                case "create":
                    const _c = <R>{ 
                        created: false, 
                        id: 0, 
                        error
                    }
                    return this.usePromise ? Promise.reject(_c) : _c
                case "update":
                    const _u = <R>{ updated: false, error }
                    return this.usePromise ? Promise.reject(_u) : _u
                case "delete":
                    const _d = <R>{ deleted: false, error }
                    return this.usePromise ? Promise.reject(_d) : _d
                case "select":
                default:
                    const _s = <R>{ hasRows: false, count: 0, row: null, rows: [], error }
                    return this.usePromise ? Promise.reject(_s) : _s
            }
        }
        finally {
            Object.entries(removedMethods).forEach(([method, fn]) => {
                (Object.prototype as any)[method] = fn;
            });
        }
    }

    /**
     * Handles the fulfillment and rejection of the promise.
     * @param onfulfilled - The callback to execute when the promise is fulfilled.
     * @param onrejected - The callback to execute when the promise is rejected.
     * @returns A promise that resolves with the result of the callback.
     */
    then<TResult1 = R, TResult2 = never>(
        onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }
}

export default ZormQueryBuilder