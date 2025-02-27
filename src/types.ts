import { ObjectLiteral } from "typeorm"

export type dynamicObject = { 
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
    params: dynamicObject
}

export type QueryAction = "create" | "upsert" | "select" | "update" | "delete"
export type QueryResult = InsertQueryResult | SelectQueryResult | UpdateQueryResult | DeleteQueryResult

export type QueryError = {
    code: number | string,
    message: string,
    query: string,
    values: string[]
}

export type InsertQueryResult = {
    created: boolean,
    id?: number,
    record?: ObjectLiteral,
    records?: ObjectLiteral[]
    error?: QueryError
}

export type SelectQueryResult = {
    hasRows: boolean,
    count?: number,
    row?: any,
    rows?: any[],
    error?: QueryError
}

export type UpdateQueryResult = {
    updated: boolean,
    record?: ObjectLiteral,
    records?: ObjectLiteral[],
    error?: QueryError
}

export type DeleteQueryResult = {
    deleted: boolean,
    count: number,
    error?: QueryError
}

export { 
    Entity, PrimaryColumn, PrimaryGeneratedColumn, Column, BaseEntity,
    OneToOne, JoinColumn, 
} from "typeorm";