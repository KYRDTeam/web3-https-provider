# web3-providers-http

This is a HTTP provider sub-package forked form https://github.com/web3/web3.js/tree/1.x/packages/web3-providers-http.

## Installation

You can install the package either:

### Using NPM

```bash
npm install https://github.com/KYRDTeam/web3-https-provider.git
```

### Using Yarn

```bash
yarn add https://github.com/KYRDTeam/web3-https-provider.git
```

## Usage

```js
const http = require('http');
const Web3HttpProvider = require('web3-providers-http');

const options = {
    keepAlive: true,
    timeout: 20000, // milliseconds,
    headers: [{name: 'Access-Control-Allow-Origin', value: '*'},{...}],
    withCredentials: false,
    agent: {http: http.Agent(...), baseUrl: ''}
};

const provider = new Web3HttpProvider(['http://localhost:8545'], options);
```

## Types

All the TypeScript typings are placed in the `types` folder.
