import { ObjectLiteral } from "typeorm"

export type dynamic= { 
    [x: string] : any 
}

export interface ModelGenerator {
    generate: () => void,
    connection: () => ConnectionDetails,
    mapColumns: (sqlType: string) => void
}

export type ConnectionDetails = {
    host: string, 
    port: string | number, 
    user: string, 
    password: string, 
    database: string,
    params: dynamic
}

export type QueryAction = "create" | "upsert" | "select" | "update" | "delete"
export type QueryResult = InsertQueryResult | SelectQueryResult | UpdateQueryResult | DeleteQueryResult

/**
 * Defines supported comparison operators for filtering queries.
 * Enables IntelliSense support in `.where()` conditions.
 * 
 * @template T The type of the value being compared (e.g., number, string, Date).
 */
export type WhereOperators<T> = {
    /**
     * Greater than (`>`) operator.
     * 
     * @example
     * query.where({ age: { gt: 18 } }) // WHERE age > 18
     */
    gt?: T;

    /**
     * Greater than or equal to (`>=`) operator.
     * 
     * @example
     * query.where({ price: { gte: 100 } }) // WHERE price >= 100
     */
    gte?: T;

    /**
     * Less than (`<`) operator.
     * 
     * @example
     * query.where({ age: { lt: 30 } }) // WHERE age < 30
     */
    lt?: T;

    /**
     * Less than or equal to (`<=`) operator.
     * 
     * @example
     * query.where({ date: { lte: '2024-01-01' } }) // WHERE date <= '2024-01-01'
     */
    lte?: T;

    /**
     * Not equal (`!=`) operator.
     * 
     * @example
     * query.where({ status: { ne: 'inactive' } }) // WHERE status != 'inactive'
     */
    ne?: T;

    /**
     * Equal (`=`) operator.
     * This is typically unnecessary since `.where({ key: value })` already handles equality.
     * 
     * @example
     * query.where({ id: { eq: 1 } }) // WHERE id = 1
     */
    eq?: T;
};

export type PartialConditions<T> = Partial<Record<keyof T, string | number | boolean | WhereOperators<any>>>

export type QueryError = {
    code: number | string,
    message: string,
    query: string,
    values: string[]
}

export type InsertQueryResult<T = ObjectLiteral> = {
    created: boolean,
    id?: number; // Last insert ID
    ids?: number[]; // Array of IDs for bulk inserts
    record?: T;
    records?: T[];
    error?: QueryError
}

export type SelectQueryResult<T = ObjectLiteral> = (
    | {
        hasRows: true;
        row: T;
        rows: T[];
        count: number;
      }
    | {
        hasRows: false;
        row?: never;
        rows: [];
        count: 0;
      }
) & {
    error?: QueryError,
    /** Saves the current state of 'row' to the database */
    save?: () => Promise<T | null>;
    /** Updates multiple fields on 'row' simultaneously */
    patch?: (data: Partial<T>) => T | null;
}

export type UpdateQueryResult<T = ObjectLiteral> = (
    | {
        updated: true;
        affected: number;
        record: T;            // Required and non-nullable when hasRows is true
        records: T[]; 
      }
    | {
        updated: false;
        affected: 0;
        record?: never;            // Required and non-nullable when hasRows is true
        records?: never[]; 
      }
) & {
    error?: QueryError;
}

export type DeleteQueryResult = {
    deleted: boolean,
    count: number,
    error?: QueryError
}

export { BaseEntity, Column, Entity, JoinColumn, ManyToMany, ManyToOne, OneToMany, OneToOne, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm"

