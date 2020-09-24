const { createJoinCQNFromExpanded, rawToExpanded } = require('@sap/cds-runtime/lib/db/expand')
const { sqlFactory } = require('@sap/cds-runtime/lib/db/sql-builder')
const PGSelectBuilder = require('./db/SelectBuilder')
const {
    postProcess
} = require('@sap/cds-runtime/lib/db/data-conversion/post-processing');


function _cqnToSQL(model, query) {
    return sqlFactory(
        query,
           {
               customBuilder: {
                   SelectBuilder: PGSelectBuilder
               }
           },
        model
    )
}

const formatValues = (value) => {
    switch(typeof value){
        case 'string':{
            return `'${value}'`
        }
        default:
            return value
    }
}

const processExpand = (dbc, cqn, model) => {
    let queries = [];
    const expandQueries = createJoinCQNFromExpanded(cqn, model, true)
    for (const cqn of expandQueries.queries) {
        //cqn._conversionMapper = getPostProcessMapper(HANA_TYPE_CONVERSION_MAP, model, cqn)

        // REVISIT
        // Why is the post processing in expand different?
        const { sql, values } = _cqnToSQL(model, cqn)
        let query = sql.split('?')
            .filter(part => part && part !== 'undefined')
            .map((part, i) => {
                return part + formatValues(values[i])
            }).join('');
            if (process.env.DEBUG || process.env.CDS_DEBUG) {
                console.info('[cds-pg]', '-', 'query >\n', query)
            }
        queries.push(_executeSelectSQL(dbc, query, values, false))
    }

    return rawToExpanded(expandQueries, queries, cqn.SELECT.one)
}

function _executeSelectSQL(dbc, sql, values, isOne, postMapper, propertyMapper, objStructMapper) {
    return dbc.query(sql).then(result => {
        if (isOne) {
            result = result.length > 0 ? result[0] : null
        }

        return postProcess(result.rows, postMapper, propertyMapper, objStructMapper)
    })
}



module.exports = {
    processExpand
}
