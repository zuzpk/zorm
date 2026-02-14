import path from "path";
import pc from "picocolors";
import "reflect-metadata";
import { DataSource, EntitySchema, EntityTarget, MixedList, ObjectLiteral, Repository } from "typeorm";
import { checkDirectory } from "./core/index.js";
import { MySqlDriver } from "./drivers/mysql/index.js";
import ZormQueryBuilder from "./drivers/queryBuilder.js";
import { DeleteQueryResult, InsertQueryResult, QueryAction, QueryResult, SelectQueryResult, UpdateQueryResult } from "./types.js";

/**
 * Zorm is a lightweight ORM wrapper around TypeORM with support for MySQL.
 */
class Zorm {

    /**
     * Singleton instance of Zorm.
     * @private
     */
    private static instance: Zorm;
    
    /**
     * TypeORM DataSource instance.
     * @private
     */
    private dataSource!: DataSource;

    /**
     * Flag to track if the connection is initialized.
     * @private
     */
    private initialized: boolean = false;

    /**
     * Determines whether to use Promises for queries.
     * @private
     */
    private usePromise: boolean = false;
    
    private _init!: () => Promise<DataSource>;

    /**
     * Private constructor to enforce singleton pattern.
     * @param {string} connectionString - The database connection string.
     * @param {string | null} [entitiesPath] - Path to the entities directory.
     * @param {boolean} [usePromise] - Whether to use Promises for queries.
     * @private
     */
    private constructor(
        connectionString: string, 
        entities?: MixedList<string | Function | EntitySchema<any>>,
        entitiesPath?: string | null, 
        usePromise?: boolean
    ){

        const _dist = entitiesPath || path.join(`src`, `zorm`)
        const dist = path.join(process.cwd(), _dist)
        const _checkDist = checkDirectory(dist, false)
        this.usePromise = usePromise || false;
        if ( !_checkDist.access ){
            console.log( pc.red(`○ ${_checkDist.message}`) )
            return;
        }

        if ( connectionString.startsWith(`mysql`) ){
        
                const driver = new MySqlDriver(decodeURIComponent(connectionString))
                const conn = driver.connection()

                
                    
                this.dataSource = new DataSource({
                    type: "mysql",
                    username: conn.user,
                    password: conn.password,
                    host: conn.host,
                    port: Number(conn.port),
                    database: conn.database,
                    entities: entities || []
                })

                this._init = this.dataSource.initialize.bind(this.dataSource)
        
        }
        else{
            console.log(`Only MySQL is supported for now`)
            process.exit(1);
        }

    }

    /**
     * Returns the singleton instance of Zorm.
     * @param {string} connectionString - The database connection string.
     * @param {string | null} [entitiesPath] - Path to the entities directory.
     * @param {boolean} [usePromise] - Whether to use Promises for queries.
     * @returns {Zorm} The singleton instance of Zorm.
     */
    static get(
        connectionString: string, 
        entities?: MixedList<string | Function | EntitySchema<any>>,
        entitiesPath?: string | null, 
        usePromise?: boolean
    ){
        if ( !Zorm.instance ){
            Zorm.instance = new Zorm(connectionString, entities, entitiesPath!, usePromise)
        }

        return Zorm.instance
    }

    /**
     * Connects to the database and initializes entities.
     * @param {MixedList<string | Function | EntitySchema<any>>} entities - List of entity schemas.
     * @returns {Promise<void>} Resolves when the connection is initialized.
     */
    async connect(entities?: MixedList<string | Function | EntitySchema<any>>){
        if ( !this.initialized ){
            try{
                if (entities && !this.dataSource.options.entities?.length) {
                    this.dataSource.setOptions({ entities });
                }
                await this._init()
                this.initialized = true
                console.log(pc.green("○ Zorm is connected"))
            }
            catch(e){
                console.log(pc.red("○ Error while connecting to your MySQL Server with following error:"), e)
            }
        }
    }

    whenReady<T = this>(): T {

        if (this.initialized) return this as any;

        const handler: ProxyHandler<this> = {
            get: (target, prop: string) => {
                if (prop === 'then') return undefined;
                const value = (target as any)[prop];
                if (typeof value === 'function') {
                    return (...args: any[]) => {

                        const result = value.apply(target, args);

                        if (result && result.constructor.name === 'ZormQueryBuilder') {
                            return this.wrapQueryBuilder(result);
                        }

                        this._init().then(() => result);
                    }
                }
                return value;
            }
        };

        return new Proxy(this, handler) as any
    }

    private wrapQueryBuilder<T>(qb: any): any {
        const handler: ProxyHandler<any> = {
            get: (target, prop: string) => {
                if (prop === 'then') return undefined;

                const value = target[prop];
                if (typeof value === 'function') {
                    return (...args: any[]) => {
                        const result = value.apply(target, args);
                        // Chain: if returns new QB, wrap it
                        if (result && result.constructor.name === 'ZormQueryBuilder') {
                            return this.wrapQueryBuilder(result);
                        }
                        // Final: return Promise
                        return this._init().then(() => result);
                    };
                }
                return value;
            }
        };

        return new Proxy(qb, handler);
    }

    /**
     * Returns the appropriate QueryBuilder based on the database type.
     * @param {EntityTarget<T>} entity - The entity target.
     * @param {QueryAction} action - The query action type.
     * @returns {ZormQueryBuilder<T, R>} Query builder instance.
     * @private
     */
    private getQueryBuilder<T extends ObjectLiteral, R = QueryResult>(entity: EntityTarget<T>, action: QueryAction) {
        const repository = this.getRepository(entity);

        switch (this.dataSource.options.type) {
            case "mysql":
            case "mariadb":
            case "postgres":
            case "sqlite":
            case "mssql":
            case "oracle":
                return new ZormQueryBuilder<T, R>(repository, action, this.usePromise);
            case "mongodb":
                throw new Error("MongoDB does not support QueryBuilder. Use repository methods instead.");
            default:
                throw new Error(`Unsupported database type: ${this.dataSource.options.type}`);
        }
    }

    /**
     * Retrieves the repository for a given entity.
     * @param {EntityTarget<T>} entity - The entity target.
     * @returns {Repository<T>} The repository instance.
     */
    getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>): Repository<T> {
        return this.dataSource.getRepository(entity);
    }

    /**
     * Creates a new record in the database.
     * @param {EntityTarget<T>} entity - The entity target.
     * @returns {ZormQueryBuilder<T, InsertQueryResult>} The query builder instance.
     */
    create<T extends ObjectLiteral>(entity: EntityTarget<T>): ZormQueryBuilder<T, InsertQueryResult> {
        return this.getQueryBuilder(entity, "create");
    }

    /**
     * Finds records in the database.
     * @param {EntityTarget<T>} entity - The entity target.
     * @returns {ZormQueryBuilder<T, SelectQueryResult>} The query builder instance.
     */
    find<T extends ObjectLiteral>(entity: EntityTarget<T>): ZormQueryBuilder<T, SelectQueryResult> {
        return this.getQueryBuilder(entity, "select")
    }

    // upsert<T extends ObjectLiteral>(entity: EntityTarget<T>): ZormQueryBuilder<T, InsertQueryResult> {
    //     return this.getQueryBuilder(entity, "upsert");
    // }

    /**
     * Updates records in the database.
     * @param {EntityTarget<T>} entity - The entity target.
     * @returns {ZormQueryBuilder<T, UpdateQueryResult>} The query builder instance.
     */
    update<T extends ObjectLiteral>(entity: EntityTarget<T>): ZormQueryBuilder<T, UpdateQueryResult> {
        return this.getQueryBuilder(entity, "update");
    }

    /**
     * Deletes records from the database.
     * @param {EntityTarget<T>} entity - The entity target.
     * @returns {ZormQueryBuilder<T, DeleteQueryResult>} The query builder instance.
     */
    delete<T extends ObjectLiteral>(entity: EntityTarget<T>): ZormQueryBuilder<T, DeleteQueryResult> {
        return this.getQueryBuilder(entity, "delete");
    }

}

export default Zorm

export {
    BigIntTransformer,
    BooleanTransformer
} from "./drivers/mysql";
export * from "./types.js";

