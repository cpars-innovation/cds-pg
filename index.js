const { Pool } = require('pg')
const cqn2pgsql = require('./lib/cqn2pgsql')
const dateTime = require('@sap/cds-runtime/lib/hana/dateTime.js')
const localized = require('@sap/cds-runtime/lib/hana/localized.js')
const { managed, virtual, keys, rewrite } = require('@sap/cds-runtime/lib/db/generic')
const { hasExpand } = require('@sap/cds-runtime/lib/db/expand')
const { processExpand } = require('./lib/expand')
/*eslint no-undef: "warn"*/
/*eslint no-unused-vars: "warn"*/
const cds = global.cds || require('@sap/cds/lib')

/*
 * the service
 */
module.exports = class PostgresDatabase extends cds.DatabaseService {
    constructor(...args) {
        super(...args)

        // Cloud Foundry provides the user in the field username the pg npm module expects user
        if (this.options.credentials && this.options.credentials.username) {
            this.options.credentials.user = this.options.credentials.username
        }
        this._pool = new Pool(this.options.credentials)
    }

    /**
     * Convert the cds compile -to sql output to a PostgreSQL compatible format
     * @param {String} SQL from cds compile -to sql
     * @returns {String} postgresql sql compatible SQL
     */
    cdssql2pgsql(cdssql) {
        const pgsql = cdssql.replace(/NVARCHAR/g, 'VARCHAR')
        return pgsql
    }

    init() {
        /*
         * before
         */
        // currently needed for transaction handling
        this._ensureOpen && this.before('*', this._ensureOpen)
        this._ensureModel && this.before('*', this._ensureModel)

        this.before(['CREATE', 'UPDATE'], '*', dateTime) // > has to run before rewrite

        this.before(['CREATE', 'READ', 'UPDATE', 'DELETE'], '*', this.models)
        this.before(['CREATE', 'UPDATE'], '*', keys)
        this.before(['CREATE', 'UPDATE'], '*', managed)
        this.before(['CREATE', 'UPDATE'], '*', virtual)
        this.before(['CREATE', 'READ', 'UPDATE', 'DELETE'], '*', rewrite)

        this.before('READ', '*', localized) // > has to run after rewrite
        /*
         * on
         */
        this.on('CREATE', '*', async function (req) {
            const metadata = this.findMetadata(req, req.entity)
            // this === tx or service

            // get sql and values from custom cqn2sql
            const sql = cqn2pgsql(req.query)

            // execute via db client specific api
            const result = await this.dbc.query(sql)
            // postprocess and return result
            return result;
        })
        this.on('READ', '*', async function (req) {
            const metadata = this.findMetadata(req.entity)
            if (hasExpand(req.query)) {
                const result = await processExpand(this.dbc, req.query, req._model)
                return this.formatResponse(result, metadata);
            }

            const result = await this.dbc.query(cqn2pgsql(req.query, req._model, req.entity));
            return result.rows;
        })
        this.on('UPDATE', '*', async function (req) {
            const metadata = this.findMetadata(req.entity);
            return this.dbc.query(cqn2pgsql(req.query, metadata)).then(res => res.rows);
        })
        this.on('DELETE', '*', async function (req) {
            const metadata = this.findMetadata(req.entity);
            try {
                const result = await this.dbc.query(cqn2pgsql(req.query, metadata));
                //  await  this.dbc.query('COMMIT');
                return result.rows;
            } catch (e) {
                await this.dbc.query('ROLLBACK');
            }
        })

        /*
         * after
         */
        // nothing

        /*
         * tx
         */
        this.on('BEGIN', async function (req) {
            this.dbc = await this.acquire(req)
            await this.dbc.query(req.event)

            // currently needed for continue with tx
            this._state = req.event

            return 'dummy'
        })

        this.on('COMMIT', async function (req) {
            await this.dbc.query(req.event)

            // currently needed for continue with tx
            this._state = req.event

            await this.release(this.dbc)

            return 'dummy'
        })

        this.on('ROLLBACK', async function (req) {
            try {
                await this.dbc.query(req.event)
            } finally {
                await this.release(this.dbc)
            }

            // currently needed for continue with tx
            this._state = req.event

            return 'dummy'
        })

        /*
         * "final on"
         */
        this.on('*', function (req) {
            // if you reach here, your request wasn't handled above
        })
    }

    models(req) {
        this.models = req.context._model;
    }

    /*
     * connection
     */
    async acquire(arg) {
        // const tenant = (typeof arg === 'string' ? arg : arg.user.tenant) || 'anonymous'
        const dbc = await this._pool.connect()

        // anything you need to do to prepare dbc

        return dbc
    }

    /**
     * release the query client back to the pool
     * explicitly passing a truthy value
     * see https://node-postgres.com/api/pool#releasecallback
     */
    async release(dbc) {
        await dbc.release(true)
        return 'dummy'
    }

    // if needed
    async disconnect(tenant = 'anonymous') {
        await custom_disconnect_function(tenant)
        super.disconnect(tenant)
    }


    formatResponse(data, metadata) {
        return data.map(row => {
            Object.keys(row)
                .forEach((key) => {
                    if (Array.isArray(row[key])) {
                        const innerMetadata = this.findMetadata(metadata.elements[key].target)
                        row[key] = this.formatResponse(row[key], innerMetadata)
                    } else {
                        const fieldType = this.findFieldType(key, metadata);
                        switch (fieldType) {
                            case "cds.Timestamp":
                                row[key] = row[key] ? row[key].toISOString() : row[key]
                                break;
                            default:
                                break;
                        }
                    }
                });
            return row;
        });
    }


    findMetadata(entity) {
        return this.models.definitions[entity];
    }

    findFieldType(fieldName, metadata) {
        const elements = metadata.elements;
        return elements[fieldName].type;
    }
}
