import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { ConnectionDetails, ModelGenerator } from '../../types.js';
import pc from "picocolors"
import { toPascalCase } from '../../core/index.js';

export const parseConnectionString = (connectionString: string) => {
    const regex = /mysql:\/\/(?<user>[^:]+):(?<password>[^@]+)@(?<host>[^:/]+)(?::(?<port>\d+))?\/(?<database>[^?]+)(?:\?(?<params>.+))?/;
    const match = connectionString.match(regex);

    if (!match || !match.groups) {
        throw new Error("Invalid MySQL connection string");
    }

    const { user, password, host, port, database, params } = match.groups;
    
    const queryParams = params ? Object.fromEntries(new URLSearchParams(params)) : {};

    return { user, password, host, port: port ? Number(port) : 3306, database, params: queryParams };
};

export const MySQLErrorMap : Record<string, string> = {
    ER_DUP_ENTRY: "DuplicateEntry",
    ER_NO_REFERENCED_ROW: "ForeignKeyConstraintFails",
    ER_NO_REFERENCED_ROW_2: "ForeignKeyConstraintFails",
    ER_BAD_NULL_ERROR: "NullValueNotAllowed",
    ER_PARSE_ERROR: "SQLSyntaxError",
    ER_ACCESS_DENIED_ERROR: "AccessDenied",
    ER_TABLE_EXISTS_ERROR: "TableAlreadyExists",
    ER_NO_SUCH_TABLE: "TableNotFound",
    ER_LOCK_WAIT_TIMEOUT: "LockWaitTimeout",
    ER_LOCK_DEADLOCK: "DeadlockDetected",
    ER_DATA_TOO_LONG: "DataTooLong",
    ER_TRUNCATED_WRONG_VALUE: "InvalidDataFormat",
    ER_WRONG_VALUE_COUNT_ON_ROW: "WrongValueCount",
    ER_CANT_CREATE_TABLE: "TableCreationFailed",
    ER_CANT_DROP_FIELD_OR_KEY: "CannotDropKey",
    ER_ROW_IS_REFERENCED: "RowReferenced",
    ER_ROW_IS_REFERENCED_2: "RowReferenced",
    ER_PRIMARY_CANT_HAVE_NULL: "PrimaryKeyCannotBeNull",
    ER_KEY_COLUMN_DOES_NOT_EXITS: "KeyColumnNotFound",
    ER_UNKNOWN_COLUMN: "UnknownColumn",
    ER_WRONG_DB_NAME: "InvalidDatabaseName",
    ER_WRONG_TABLE_NAME: "InvalidTableName",
    ER_UNKNOWN_PROCEDURE: "ProcedureNotFound",
    ER_DUP_UNIQUE: "UniqueConstraintViolation",
    ER_SP_DOES_NOT_EXIST: "StoredProcedureNotFound",
    ER_BAD_FIELD_ERROR: "InvalidColumn",
};

export class MySqlDriver implements ModelGenerator {

    pool: Pool | null
    conn: ConnectionDetails
    dist: string | null;

    constructor(connectionString: string, dist?: string){
        this.pool = null
        this.dist = dist || null
        this.conn = this.parseConnectionString(connectionString);
    }

    connection(){
        return this.conn
    }

    parseConnectionString = (connectionString: string) => {
        const regex = /mysql:\/\/(?<user>[^:]+):(?<password>[^@]+)@(?<host>[^:/]+)(?::(?<port>\d+))?\/(?<database>[^?]+)(?:\?(?<params>.+))?/;
        const match = connectionString.match(regex);
    
        if (!match || !match.groups) {
            throw new Error("Invalid MySQL connection string");
        }
    
        const { user, password, host, port, database, params } = match.groups;
        
        const queryParams = params ? Object.fromEntries(new URLSearchParams(params)) : {};
    
        return { user, password, host, port: port ? Number(port) : 3306, database, params: queryParams };
    };

    createPool(){
        if ( !this.pool ){

            try{

                this.pool = mysql.createPool({
                    user: this.conn.user,
                    password: this.conn.password,
                    host: this.conn.host,
                    port: this.conn.port,
                    database: this.conn.database,
                    ...this.conn.params
                } as unknown as PoolOptions)

                this.pool.getConnection()
                    .then((connection) => {
                        console.log( pc.green( "✓ MySQL Connected...") );
                        connection.release();
                    })
                    .catch((err) => {
                        console.error(pc.red( "○ Error while connecting to your MySQL Server with following error:"), err);
                        process.exit(1); // Exit process if connection fails
                    });

            }
            catch (error) {
                console.error( pc.red("○ Error while connecting to your MySQL Server with following error:"), error);
                process.exit(1);
            }
            
        }
    }

    mapColumns(sqlType: string): { tsType: string; columnType: string; length?: number } {

        const typeMap: Record<string, { tsType: string; columnType: string; length?: number }> = {
            "int": { tsType: "number", columnType: "int" },
            "tinyint": { tsType: "boolean", columnType: "tinyint" },
            "smallint": { tsType: "number", columnType: "smallint" },
            "mediumint": { tsType: "number", columnType: "mediumint" },
            "bigint": { tsType: "string", columnType: "bigint" }, // bigint is safer as string
            "decimal": { tsType: "string", columnType: "decimal" },
            "float": { tsType: "number", columnType: "float" },
            "double": { tsType: "number", columnType: "double" },
            "varchar": { tsType: "string", columnType: "varchar", length: 255 },
            "text": { tsType: "string", columnType: "text" },
            "longtext": { tsType: "string", columnType: "longtext" },
            "char": { tsType: "string", columnType: "char", length: 1 },
            "datetime": { tsType: "Date", columnType: "datetime" },
            "timestamp": { tsType: "Date", columnType: "timestamp" },
            "date": { tsType: "Date", columnType: "date" },
            "time": { tsType: "string", columnType: "time" },
            "json": { tsType: "any", columnType: "json" },
        };

        const match = sqlType.match(/^(\w+)(?:\((\d+)\))?/);
        if (!match) return { tsType: "any", columnType: "varchar", length: 255 };

        const baseType = match[1].toLowerCase();
        const length = match[2] ? parseInt(match[2], 10) : undefined;

        return typeMap[baseType] ? { ...typeMap[baseType], length: length || typeMap[baseType].length } : { tsType: "any", columnType: "varchar", length: 255 };
    }

    formatDefault(value: any, tsType: string): string | number {
        if (tsType === "number") return Number(value);
        if (tsType === "boolean") return value === "1" ? "true" : "false";
        return `"${value}"`;
    }

    async generate(){
        const self = this;
        self.createPool();

        //Extract Tables
        console.log( pc.cyan( "○ Extract Tables...") );
        const [tables]: [any[], any] = await self.pool!.execute("SHOW TABLES");

        console.log( pc.cyan( `○ ${tables.length} Tables Found.`) );
        const tableNames = tables.map((row: any) => Object.values(row)[0]);

        console.log( pc.yellow( `○ Generating Models...`) );
        for (const tableName of tableNames) {

            // Get table structure
            const [columns]: [any[], any] = await self.pool!.execute(`DESCRIBE ${tableName}`);

            
            const entityCode = [
                `/**`,
                `* AutoGenerated by @zuzjs/orm.`,
                `* @ ${new Date().toString().split(` GMT`)[0].trim()}`,
                `*/`,
                `import { Entity, PrimaryColumn, PrimaryGeneratedColumn, Column, BaseEntity } from "typeorm";\n`,
                `@Entity({ name: "${tableName}" })`,
                `export class ${toPascalCase(tableName as string)} extends BaseEntity {\n`
            ]

            for (const column of columns) {
                // const { Field, Type, Key } = column;
                const { Field, Type, Key, Null, Default, Extra } = column;
                const { tsType, columnType, length } = this.mapColumns(Type);

                // Handle primary key
                if (Key === "PRI") {
                    entityCode.push(Extra.includes("auto_increment") ? `\t@PrimaryGeneratedColumn()` : `\t@PrimaryColumn()`);
                }
                else {
                    let columnDecorator = `\t@Column({ type: "${columnType}"`;
    
                    if (length) columnDecorator += `, length: ${length}`;
                    if (Null === "YES") columnDecorator += `, nullable: true`;
                    if (Default !== null) columnDecorator += `, default: ${this.formatDefault(Default, tsType)}`;
    
                    columnDecorator += ` })`;
                    entityCode.push(columnDecorator);
                }
                
                entityCode.push(`\t${Field}!: ${tsType};\n`)
            }

            entityCode.push(`}`)

            // Write entity file
            fs.writeFileSync(path.join( this.dist!, `${tableName}.ts`), entityCode.join(`\n`));

        }

        await self.pool!.end()

        console.log( pc.green( `✓ ${tables.length} Tables Processed.`) );
        process.exit(1);
        
    }



}