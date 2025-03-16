import fs from 'fs';
import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import path from 'path';
import pc from "picocolors";
import { toPascalCase } from '../../core/index.js';
import { ConnectionDetails, ModelGenerator } from '../../types.js';

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

        // Fetch foreign keys
        const foreignKeys: Record<string, any[]> = {};
        for (const tableName of tableNames) {
            const [fkResults]: [any[], any] = await this.pool!.execute(
                `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
                [this.conn.database, tableName]
            );
            foreignKeys[tableName as string] = fkResults;
        }

        
        for (const tableName of tableNames) {
            
            const imports : string[] = []
            const _imports : string[] = [`Entity`, `BaseEntity`]
            
            // Get table structure
            const [columns]: [any[], any] = await this.pool!.execute(
                `SELECT COLUMN_NAME as \`Field\`, COLUMN_TYPE as \`Type\`, COLUMN_KEY as \`Key\`, IS_NULLABLE as \`Null\`, COLUMN_DEFAULT as \`Default\`, EXTRA as \`Extra\`, COLUMN_COMMENT as \`Comment\`
                 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION ASC`,
                [this.conn.database, tableName]
            );

            const entityCode : string[] = []

            let hasPrimary = false

            for (const column of columns) {
                // console.log(tableName, column)
                const { Field, Type, Key, Null, Default, Extra, Comment } = column;
                const { tsType, columnType, length } = this.mapColumns(Type);
                

                // Handle primary key
                if (Key === "PRI") {
                    const _priColumn = Extra.includes("auto_increment") ? `PrimaryGeneratedColumn` : `PrimaryColumn`
                    if ( !_imports.includes(_priColumn) ) _imports.push(_priColumn);
                    entityCode.push(`\t@${_priColumn}()`);
                    hasPrimary = true
                }
                else {

                    // const hasForeignKey = foreignKeys[tableName as string].find((fk) => fk.COLUMN_NAME === Field);
                    // let columnDecorator = hasForeignKey ? `\t@JoinColumn({ type: "${columnType}"` : `\t@Column({ type: "${columnType}"`;
                    let columnDecorator = `\t@Column({ type: "${columnType}"`;
                    
                    if ( !_imports.includes(`Column`) ) _imports.push(`Column`);

                    if (length) columnDecorator += `, length: ${length}`;
                    if (Null === "YES") columnDecorator += `, nullable: true`;
                    if (Default !== null) columnDecorator += `, default: ${this.formatDefault(Default, tsType)}`;
    
                    columnDecorator += ` })`;
                    entityCode.push(columnDecorator);
                }

                if ( Comment && Comment.length > 0 ){
                    entityCode.push(`\t/** @comment ${Comment} */`);
                }
                
                entityCode.push(`\t${Field}!: ${Key == `PRI` && [`int`,`bigint`].includes(Type) ? `number` : tsType};\n`)
            }

            // Add foreign key relationships
            if ( foreignKeys[tableName as string] ){
                for (const fk of foreignKeys[tableName as string] || []) {
                    const relatedEntity = toPascalCase(fk.REFERENCED_TABLE_NAME);
                    entityCode.push(`\t@OneToOne(() => ${relatedEntity})`);
                    entityCode.push(`\t@JoinColumn({ name: "${fk.COLUMN_NAME}" })`);
                    entityCode.push(`\tfk${relatedEntity}!: ${relatedEntity};\n`);
                    
                    imports.push(`import { ${relatedEntity} } from "./${fk.REFERENCED_TABLE_NAME}";`);

                    if ( !_imports.includes(`OneToOne`) ) _imports.push(`OneToOne`);
                    if ( !_imports.includes(`JoinColumn`) ) _imports.push(`JoinColumn`);
                }
            }

            const Code = [
                `/**`,
                `* AutoGenerated by @zuzjs/orm.`,
                `* @ ${new Date().toString().split(` GMT`)[0].trim()}`,
                `*/`,
                `import { ${_imports.join(`, `)} } from "@zuzjs/orm";`,
                imports.length > 0 ? imports.join(`\n`) : ``,
                `${imports.length > 0 ? `\n` : ``}@Entity({ name: "${tableName}" })`,
                `export class ${toPascalCase(tableName as string)} extends BaseEntity {\n`,
                    ...entityCode,
                `}`
            ]

            if ( !hasPrimary ){
                console.log( pc.bgRed( pc.whiteBright( ` WARNING ` ) ), pc.yellow( `○ "${tableName}" does not have a primary column. Primary column is required.`) );
            }

            // Write entity file
            fs.writeFileSync(
                path.join( this.dist!, `${tableName}.ts`), 
                Code.join(`\n`)
            );

        }

        await self.pool!.end()

        console.log( pc.green( `✓ ${tables.length} Tables Processed.`) );
        
        
    }



}