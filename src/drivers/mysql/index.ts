import fs from 'fs';
import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import path from 'path';
import pc from "picocolors";
import { ValueTransformer } from 'typeorm';
import { isNumber, toPascalCase } from '../../core/index.js';
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

export class BooleanTransformer implements ValueTransformer {
    // Converts the entity value (boolean) to the database value (e.g., tinyint/bit 0 or 1)
    to(value: boolean | null): number | null {
        if (value === null || value === undefined) return null;
        return value ? 1 : 0;
    }

    // Converts the database value (e.g., 0 or 1) to the entity value (boolean)
    from(value: number | null): boolean | null {
        if (value === null || value === undefined) return null;
        return value === 1;
    }
}

export class BigIntTransformer implements ValueTransformer {
    // We send it as a string so the DB driver handles the large digits correctly
    to(value: string | bigint | null): string | null {
        return value !== null && value !== undefined ? String(value) : null;
    }

    // MySQL driver might return a string or number; we force it to string for TS safety
    from(value: string | number | null): string | null {
        return value !== null && value !== undefined ? String(value) : null;
    }
}

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

    mapColumns(sqlType: string): { tsType: string; columnType: string; length?: number; enumValues?: string[]; transformer?: string } {

        const typeMap: Record<string, { tsType: string; columnType: string; length?: number; transformer?: string }> = {
                "int": { tsType: "number", columnType: "int" },
                "tinyint": { tsType: "boolean", columnType: "tinyint", transformer: "BooleanTransformer" },
                "smallint": { tsType: "number", columnType: "smallint" },
                "mediumint": { tsType: "number", columnType: "mediumint" },
                "bigint": { tsType: "string", columnType: "bigint", transformer: "BigIntTransformer" },
                "decimal": { tsType: "number", columnType: "decimal" },
                "float": { tsType: "number", columnType: "float" },
                "double": { tsType: "number", columnType: "double" },
                "varchar": { tsType: "string", columnType: "varchar", length: 255 },
                "char": { tsType: "string", columnType: "char", length: 1 },
                "tinytext": { tsType: "string", columnType: "tinytext" },
                "text": { tsType: "string", columnType: "text" },
                "mediumtext": { tsType: "string", columnType: "mediumtext" },
                "longtext": { tsType: "string", columnType: "longtext" },
                "datetime": { tsType: "Date", columnType: "datetime" },
                "timestamp": { tsType: "Date", columnType: "timestamp" },
                "date": { tsType: "Date", columnType: "date" },
                "time": { tsType: "string", columnType: "time" },
                "json": { tsType: "any", columnType: "json" },
            };

        const enumMatch = sqlType.match(/^enum\((.*)\)$/i);
        if (enumMatch) {
            const enumValues = enumMatch[1]
                .split(",")
                .map((val) => val.trim().replace(/^'|'$/g, "")); // Remove single quotes
    
            return { tsType: `"${enumValues.join('" | "')}"`, columnType: "enum", enumValues };
        }

        const match = sqlType.match(/^(\w+)(?:\((\d+)\))?/);
        if (!match) return { tsType: "any", columnType: "text" };

        const baseType = match[1].toLowerCase();
        const length = match[2] ? parseInt(match[2], 10) : undefined;

        const config = typeMap[baseType] || { tsType: "any", columnType: baseType };
    
        return { 
            ...config, 
            // Only apply length if it's varchar/char or explicitly defined in the DB
            length: baseType.includes("char") ? (length || config.length) : undefined 
        };

        // return typeMap[baseType] ? 
        //     { 
        //         ...typeMap[baseType], 
        //         length: length || typeMap[baseType].length 
        //     } 
        //     : { 
        //         tsType: "any", 
        //         columnType: baseType || "varchar"
        //     };
    }

    formatDefault(value: any, tsType: string): string | number {
        if (tsType === "number") return Number(value);
        if (tsType === "boolean") return value === "1" ? "true" : "false";
        return `"${value}"`;
    }

    async generate(){
        const self = this;
        self.createPool();

        const numberTypes = [`int`,`bigint`,`tinyint`,`decimal`]

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

        // Track inverse relations: { tableName: { fkColumn: targetTable } }
        const inverseRelations: Record<string, { 
            fkColumn: string; 
            fkPropName: string;
            targetTable: string; 
            targetEntity: string 
        }[]> = {};

        // Populate inverse map
        for (const [tableName, fks] of Object.entries(foreignKeys)) {
            for (const fk of fks) {
                const targetTable = fk.REFERENCED_TABLE_NAME;
                const fkColumn = fk.COLUMN_NAME;
                const fkPropName = `fk${toPascalCase(targetTable)}`;

                if (!inverseRelations[targetTable]) {
                    inverseRelations[targetTable] = [];
                }

                inverseRelations[targetTable].push({
                    fkColumn,
                    fkPropName,
                    targetTable: tableName,
                    targetEntity: toPascalCase(tableName),
                });
            }
        }

        // Detect 2 Column Junction Tables for ManyToMany
        const junctionTables: Record<string, { left: string; right: string; leftCol: string; rightCol: string }> = {};

        for (const tableName of tableNames) {
            const [cols]: [any[], any] = await this.pool!.execute(
                `SELECT COLUMN_NAME, COLUMN_KEY, EXTRA FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [this.conn.database, tableName]
            );

            const fks = foreignKeys[String(tableName)] || [];
            if (fks.length !== 2) continue;

            // Must have exactly 2 columns
            if (cols.length !== 2) continue;

            // Both columns must be primary key
            if (cols.filter(c => c.COLUMN_KEY !== 'PRI').length > 0) continue;

            const [left, right] = fks;
            const [t1, t2] = [left.REFERENCED_TABLE_NAME, right.REFERENCED_TABLE_NAME].sort();
            const key = `${t1}_${t2}`;
            if (!junctionTables[key]) {
                junctionTables[key] = {
                    left: t1,
                    right: t2,
                    leftCol: left.COLUMN_NAME,
                    rightCol: right.COLUMN_NAME
                };
            }
        }
        
        for (const tableName of tableNames) {
            
            const enums : string[] = []
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
                const { tsType, columnType, length, enumValues, transformer } = this.mapColumns(Type);
                
                let enumName : string | null = null

                if (columnType === "enum" && enumValues) {

                    enumName = toPascalCase(Field);
                    enums.push(`export enum ${enumName} { ${enumValues.map(v => {
                        return `${isNumber(v) ? `val${v}` : toPascalCase(v)} = "${v}"`
                    }).join(", ")} }`);

                }

                // Handle primary key
                if (Key === "PRI") {
                    const _priColumn = Extra.includes("auto_increment") ? `PrimaryGeneratedColumn` : `PrimaryColumn`
                    if ( !_imports.includes(_priColumn) ) _imports.push(_priColumn);
                    if ( transformer ){
                        if (!_imports.includes(transformer)) _imports.push(transformer);
                        entityCode.push(`\t@${_priColumn}({ transformer: new ${transformer}() })`);
                    }
                    else entityCode.push(`\t@${_priColumn}()`);
                    hasPrimary = true
                }
                else {

                    if ( !_imports.includes(`Column`) ) _imports.push(`Column`);

                    const columnOptions: string[] = [`type: "${columnType}"`];
                    if (length) columnOptions.push(`length: ${length}`);
                    if (Null === "YES") columnOptions.push(`nullable: true`);
                    if (enumName) columnOptions.push(`enum: ${enumName}`);
                    if (Default !== null) columnOptions.push(`default: ${this.formatDefault(Default, tsType)}`);
                    if (transformer) {
                        if (!_imports.includes(transformer)) _imports.push(transformer);
                        columnOptions.push(`transformer: new ${transformer}()`);
                    }

                    entityCode.push(`\t@Column({ ${columnOptions.join(", ")} })`);
                }

                if ( Comment && Comment.length > 0 ){
                    entityCode.push(`\t/** @comment ${Comment} */`);
                }
                
                const finalTsType = enumName || tsType
                entityCode.push(`\t${Field}!: ${finalTsType};\n`)
                // entityCode.push(`\t${Field}!: ${enumName ? enumName : Key == `PRI` && numberTypes.includes(Type) ? `number` : numberTypes.includes(Type) ? `number` : tsType};\n`)
                
            }
            // for (const column of columns) {
            //     // console.log(tableName, column)
            //     const { Field, Type, Key, Null, Default, Extra, Comment } = column;
            //     const { tsType, columnType, length, enumValues } = this.mapColumns(Type);
                
            //     let enumName : string | null = null

            //     if (columnType === "enum" && enumValues) {

            //         enumName = toPascalCase(Field);
            //         enums.push(`export enum ${enumName} { ${enumValues.map(v => {
            //             return `${isNumber(v) ? `val${v}` : toPascalCase(v)} = "${v}"`
            //         }).join(", ")} }`);

            //     }

            //     // Handle primary key
            //     if (Key === "PRI") {
            //         const _priColumn = Extra.includes("auto_increment") ? `PrimaryGeneratedColumn` : `PrimaryColumn`
            //         if ( !_imports.includes(_priColumn) ) _imports.push(_priColumn);
            //         entityCode.push(`\t@${_priColumn}()`);
            //         hasPrimary = true
            //     }
            //     else {

            //         // const hasForeignKey = foreignKeys[tableName as string].find((fk) => fk.COLUMN_NAME === Field);
            //         // let columnDecorator = hasForeignKey ? `\t@JoinColumn({ type: "${columnType}"` : `\t@Column({ type: "${columnType}"`;
            //         let columnDecorator = `\t@Column({ type: "${columnType}"`;
                    
            //         if ( !_imports.includes(`Column`) ) _imports.push(`Column`);

            //         if (length) columnDecorator += `, length: ${length}`;
            //         if (Null === "YES") columnDecorator += `, nullable: true`;
            //         if (enumName) columnDecorator += `, enum: ${enumName}`;
            //         if (Default !== null) columnDecorator += `, default: ${this.formatDefault(Default, tsType)}`;
    
            //         columnDecorator += ` })`;
            //         entityCode.push(columnDecorator);
            //     }

            //     if ( Comment && Comment.length > 0 ){
            //         entityCode.push(`\t/** @comment ${Comment} */`);
            //     }
                
            //     const finalTsType = enumName || tsType
            //     entityCode.push(`\t${Field}!: ${finalTsType};\n`)
            //     // entityCode.push(`\t${Field}!: ${enumName ? enumName : Key == `PRI` && numberTypes.includes(Type) ? `number` : numberTypes.includes(Type) ? `number` : tsType};\n`)
                
            // }

            // Add foreign key relationships
            if ( foreignKeys[tableName as string] ){
                for (const fk of foreignKeys[tableName as string] || []) {

                    const relatedEntity = toPascalCase(fk.REFERENCED_TABLE_NAME);

                    if ( imports.includes(`import { ${relatedEntity} } from "./${fk.REFERENCED_TABLE_NAME}";`) === false ){

                        entityCode.push(`\t@OneToOne(() => ${relatedEntity})`);
                        entityCode.push(`\t@JoinColumn({ name: "${fk.COLUMN_NAME}" })`);
                        entityCode.push(`\tfk${relatedEntity}!: ${relatedEntity};\n`);
                        
                        imports.push(`import { ${relatedEntity} } from "./${fk.REFERENCED_TABLE_NAME}";`);

                        if ( !_imports.includes(`OneToOne`) ) _imports.push(`OneToOne`);
                        if ( !_imports.includes(`JoinColumn`) ) _imports.push(`JoinColumn`);

                    }
                }
            }

            // Add OneToMany Relations
            const inverse = inverseRelations[String(tableName)] || [];
            for (const rel of inverse) {

                const propName = rel.targetTable.endsWith('s') ? rel.targetTable : `${rel.targetTable}s`;
                if (entityCode.some(line => line.includes(` ${propName}!:`))) continue;

                const importLine = `import { ${rel.targetEntity} } from "./${rel.targetTable}";`;
                if (!imports.includes(importLine)) imports.push(importLine);

                if (!_imports.includes('OneToMany')) _imports.push('OneToMany');

                // CORRECT: Inverse is fk + referenced table (e.g. fkUsers)
                entityCode.push(`\t@OneToMany(() => ${rel.targetEntity}, r => r.${rel.fkPropName})`);
                entityCode.push(`\tfk${toPascalCase(propName)}!: ${rel.targetEntity}[];\n`);
                // entityCode.push(`\t@OneToMany(() => ${targetEntity}, r => r.${rel.fkColumn})`);
                // entityCode.push(`\tfk${toPascalCase(propName)}!: ${targetEntity}[];\n`);

            }

            // Add Many-to-Many Relations
            const junctions = Object.values(junctionTables)
                .filter(j => j.left === tableName || j.right === tableName);
            
            for (const j of junctions) {
                const targetTable = j.left === tableName ? j.right : j.left;
                const targetEntity = toPascalCase(targetTable);
                const propName = targetTable.endsWith('s') ? targetTable : `${targetTable}s`;

                if (entityCode.some(line => line.includes(`@${propName}`))) continue;

                const importLine = `import { ${targetEntity} } from "./${targetTable}";`;
                if (!imports.includes(importLine)) {
                    imports.push(importLine);
                }

                if (!_imports.includes('ManyToMany')) _imports.push('ManyToMany');
                if (!_imports.includes('JoinTable')) _imports.push('JoinTable');

                entityCode.push(`\t@ManyToMany(() => ${targetEntity})`);
                entityCode.push(`\t@JoinTable()`);
                entityCode.push(`\tom${propName}!: ${targetEntity}[];\n`);
            }

            const Code = [
                `/**`,
                `* AutoGenerated by @zuzjs/orm.`,
                `* @ ${new Date().toString().split(` GMT`)[0].trim()}`,
                `*/`,
                `import { ${_imports.join(`, `)} } from "@zuzjs/orm";`,
                imports.length > 0 ? imports.join(`\n`) : ``,
                enums.length > 0 ? enums.join(`\n`) : ``,
                `${enums.length > 0 || imports.length > 0 ? `\n` : ``}@Entity({ name: "${tableName}" })`,
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
        
        // Write entry file i.e index.ts
        const entry = tableNames
                .map(tableName => `import { ${toPascalCase(tableName as string)} } from "./${tableName}";`)

        entry.push(
            `import Zorm from "@zuzjs/orm";`,
            `import de from "dotenv";`,
            `de.config()`,
            `const zormEntities = [${tableNames.map(t => toPascalCase(t as string)).join(`, `)}];`,
            `const zorm = Zorm.get(`,
                `\tprocess.env.DATABASE_URL!,`, 
                `\tzormEntities`,
            `);`,
            `zorm.connect(zormEntities);`,
            `export default zorm`,
            `export { ${tableNames.map(t => toPascalCase(t as string)).join(`, `)} }`,
        )
                
        fs.writeFileSync(
            path.join( this.dist!, `index.ts`), 
            entry.join(`\n`)
        );
        
        await self.pool!.end()

        console.log( pc.green( `✓ ${tables.length} Tables Processed.`) );
        
        
    }



}