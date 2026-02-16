import { ObjectLiteral } from "typeorm";

class ZormExprBuilder<T extends ObjectLiteral> {

    private _parts: string[] = [];
    private _params: Record<string, any> = {};
    private _paramIdx = 0;
    private _alias: string;
    private static globalParamIdx = 0;

    constructor(
        alias?: string,
        parent?: { params: Record<string, any>; idx: number }
    ) {
        this._alias = alias ? `${alias}.` : ``;
        this._paramIdx = parent ? parent.idx : 0;
        this._params = parent ? parent.params : {};
    }

    private _applyOperator(operator: string, value: any): this {
        const key = `p${this._paramIdx++}`;
        this.append(` ${operator} :${key}`);
        this._params[key] = value;
        return this;
    }

    field(col: keyof T | string): this {
        this._parts.push(`${this._alias}${String(col)}`);
        return this;
    }

    equals(value: any) : this {
        return this._applyOperator(`=`, value)
    }
    
    greaterThan(value: any) : this {
        return this._applyOperator(`>`, value)
    }

    lessThan(value: any) : this {
        return this._applyOperator(`<`, value)
    }

    greaterThanAndEqualTo(value: any) : this {
        return this._applyOperator(`>=`, value)
    }

    lessThanAndEqualTo(value: any) : this {
        return this._applyOperator(`<=`, value)
    }

    notEquals(value: any) : this {
        return this._applyOperator(`!=`, value)
    }

    between(start: any, end: any): this {
        const keyStart = `p${this._paramIdx++}`;
        const keyEnd = `p${this._paramIdx++}`;
        
        this.append(` BETWEEN :${keyStart} AND :${keyEnd}`);
        
        this._params[keyStart] = start;
        this._params[keyEnd] = end;
        
        return this;
    }

    in(values: any[]): this {
        if (!Array.isArray(values) || values.length === 0) {
            // Optional: Handle empty arrays to prevent SQL syntax errors
            // Usually, "IN (NULL)" or forcing a false condition is safest
            this.append(` IN (NULL)`);
            return this;
        }

        const key = `p${this._paramIdx++}`;
        // TypeORM uses the :...key syntax to expand arrays into (val1, val2, ...)
        this.append(` IN (:...${key})`);
        this._params[key] = values;

        return this;
    }

    notIn(values: any[]): this {
        if (!Array.isArray(values) || values.length === 0) {
            this.append(` NOT IN (NULL)`);
            return this;
        }

        const key = `p${this._paramIdx++}`;
        this.append(` NOT IN (:...${key})`);
        this._params[key] = values;

        return this;
    }

    isNull(): this {
        this.append(` IS NULL`);
        return this;
    }

    isNotNull(): this {
        this.append(` IS NOT NULL`);
        return this;
    }

    like(value: string): this {
        const key = `p${this._paramIdx++}`;
        this.append(` LIKE :${key}`);
        this._params[key] = value; // Expects user to provide "%" wildcards
        return this;
    }

    /**
     * MySQL Full-Text Search
     * @param columns Optional array of columns. If omitted, uses the field defined by .field()
     */
    match(value: string, columns?: string[]): this {
        const key = `p${this._paramIdx++}`;
        
        // If columns are provided, we replace the last part (the field) with the MATCH syntax
        if (columns && columns.length > 0) {
            const cols = columns.map(c => c.includes('.') ? c : `${this._alias}${c}`).join(', ');
            this._parts[this._parts.length - 1] = `MATCH(${cols})`;
        } else {
            // Otherwise, wrap the existing field in MATCH()
            this.wrap(expr => `MATCH(${expr})`);
        }

        this.append(` AGAINST (:${key} IN BOOLEAN MODE)`);
        this._params[key] = value;
        return this;
    }

    contains(value: string): this {
        const key = `p${this._paramIdx++}`;
        this.append(` LIKE :${key}`);
        this._params[key] = `%${value}%`;
        return this;
    }

    startsWith(value: string): this {
        const key = `p${this._paramIdx++}`;
        this.append(` LIKE :${key}`);
        this._params[key] = `${value}%`;
        return this;
    }

    endsWith(value: string): this {
        const key = `p${this._paramIdx++}`;
        this.append(` LIKE :${key}`);
        this._params[key] = `%${value}`;
        return this;
    }

    // equals(value: any): this {
    //     const key = `p${this._paramIdx++}`;
    //     this.append(` = :${key}`);
    //     this._params[key] = value;
    //     return this;
    // }

    append(extra: string): this {
        if (this._parts.length === 0) throw new Error("Cannot append to empty expression");
        this._parts[this._parts.length - 1] += extra;
        return this;
    }
    
    wrap(wrapper: (expr: string) => string): this {
        if (this._parts.length === 0) throw new Error("Cannot wrap empty expression");
        this._parts[this._parts.length - 1] = wrapper(this._parts[this._parts.length - 1]);
        return this;
    }

    exists(sub: (q: ZormExprBuilder<T>) => ZormExprBuilder<T>): this {
        const subQ = new ZormExprBuilder<T>(undefined, { params: this._params, idx: this._paramIdx });
        sub(subQ);
        // const { expression, param } = subQ.toExpression();
        this._parts.push(`EXISTS (${subQ.buildExpression()})`);
        // Object.assign(this._params, param);
        this._paramIdx = subQ._paramIdx;
        return this;
    }

    select(expr: string): this {
        this._parts.push(`SELECT ${expr}`);
        return this;
    }

    from(table: string, alias: string): this {
        this._parts.push(`FROM ${table} ${alias}`);
        this._alias = alias;
        return this;
    }

    where(cond: Record<string, any>): this {
        const whereParts: string[] = [];
        for (const [k, v] of Object.entries(cond)) {
        const key = `p${this._paramIdx++}`;
        whereParts.push(`${k} = :${key}`);
            this._params[key] = v;
        }
        this._parts.push(`WHERE ${whereParts.join(' AND ')}`);
        return this;
    }

    // or(sub: ZormExprBuilder<any> | { expression: string; param: Record<string, any> }): this {
    //     const { expression, param } = 'toExpression' in sub ? sub.toExpression() : sub;
    //     this._parts.push(this._parts.length === 0 ? expression : `OR ${expression}`);
    //     Object.assign(this._params, param);
    //     return this;
    // }
    or(sub?: (q: ZormExprBuilder<T>) => ZormExprBuilder<T>): this {

        if ( sub){
            const subQ = new ZormExprBuilder<T>(this._alias.endsWith(`.`) ? this._alias.slice(0, -1) : this._alias, { params: this._params, idx: this._paramIdx });
            sub(subQ);
            this._parts.push(`OR (${subQ.buildExpression()})`);
            this._paramIdx = subQ._paramIdx;
            return this;
        }

        this._parts.push(`OR`);
        return this;
    }

    and(sub?: (q: ZormExprBuilder<T>) => ZormExprBuilder<T>): this {

        if ( sub){
            const subQ = new ZormExprBuilder<T>(this._alias.endsWith(`.`) ? this._alias.slice(0, -1) : this._alias, { params: this._params, idx: this._paramIdx });
            sub(subQ);
            this._parts.push(`AND (${subQ.buildExpression()})`);
            this._paramIdx = subQ._paramIdx;
            return this;
        }

        this._parts.push(`AND`);
        return this;
    }

    group() { 
        return this.wrap(e => `(${e})`); 
    }

    fromUnixTime(): this {
        this.wrap(expr => `FROM_UNIXTIME(${expr})`);
        return this;
    }

    date(): this {
        this.wrap(expr => `DATE(${expr})`);
        return this;
    }

    substring(column: keyof T | string, delimiter: string, index: number): this {
        this._parts = [`SUBSTRING_INDEX(${this._alias}${String(column)}, '${delimiter}', ${index})`];
        return this;
    }

    toExpression(): { expression: string; param: Record<string, any> } {
        return { expression: this._parts.join(' '), param: this._params };
    }

    buildExpression() { 
        return this.toExpression().expression; 
    }

    buildParams(){ 
        return this.toExpression().param; 
    }

}

export default ZormExprBuilder