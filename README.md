# About 

CLI utils to extract, transform and load documents to elasticsearch as JurisprudenciaDocument ([@stjiris/jurisprudencia-document](https://www.npmjs.com/package/@stjiris/jurisprudencia-document))

## Usage

Must use `tsc` to compile `src` and create the `dist` folder whit the script:

### Indexing from DGSI

`$ node dist/index`

```
Usage: node dist/index.js [OPTIONS]
Populate Jurisprudencia index. (jurisprudencia.11.1)
Use ES_URL, ES_USER and ES_PASS environment variables to setup the elasticsearch client
Options:
        --full, -f      Work in progress. Should update every document already indexed and check if there are deletions
        --help, -h      show this help
```
