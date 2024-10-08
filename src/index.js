/*
    This file is part of web3.js.

    web3.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    web3.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/** @file httpprovider.js
 * @authors:
 *   Marek Kotewicz <marek@parity.io>
 *   Marian Oancea
 *   Fabian Vogelsteller <fabian@ethereum.org>
 *   AyanamiTech <ayanami0330@protonmail.com>
 * @date 2015
 */
/**
 * @editor:
 * Duc-Tuyen Vu <tuyenvd596@gmail.com>
 */

var errors = require("web3-core-helpers").errors;
var http = require("http");
var https = require("https");

// Apply missing polyfill for IE
require("cross-fetch/polyfill");
require("es6-promise").polyfill();

// import abortController if abortController is not included in node
if (typeof global !== "undefined" && !global.AbortController) {
  require("abortcontroller-polyfill/dist/polyfill-patch-fetch");
}

/**
 * HttpProvider should be used to send rpc calls over http
 */
var HttpProvider = function HttpProvider(hosts, options) {
  options = options || {};

  this.withCredentials = options.withCredentials;
  this.timeout = options.timeout || 0;
  this.headers = options.headers;
  this.agent = options.agent;
  this.connected = false;
  this.currentHostIndex = 0;
  this.hosts = hosts;

  // keepAlive is true unless explicitly set to false
  const keepAlive = options.keepAlive !== false;
  this.host = this.hosts[0] || ["http://localhost:8545"];
  if (!this.agent) {
    if (this.host.substring(0, 5) === "https") {
      this.httpsAgent = new https.Agent({ keepAlive });
    } else {
      this.httpAgent = new http.Agent({ keepAlive });
    }
  }
};

/**
 * Should be used to make async request
 *
 * @method send
 * @param {Object} payload
 * @param {Function} callback triggered on end with (err, result)
 */
HttpProvider.prototype.send = function (payload, callback) {
  var options = {
    method: "POST",
    body: JSON.stringify(payload),
  };
  var headers = {};
  var controller;

  if (typeof AbortController !== "undefined") {
    controller = new AbortController();
  } else if (typeof window !== "undefined" && typeof window.AbortController !== "undefined") {
    // Some chrome version doesn't recognize new AbortController(); so we are using it from window instead
    // https://stackoverflow.com/questions/55718778/why-abortcontroller-is-not-defined
    controller = new window.AbortController();
  }

  if (typeof controller !== "undefined") {
    options.signal = controller.signal;
  }

  // the current runtime is node
  if (typeof XMLHttpRequest === "undefined") {
    // https://github.com/node-fetch/node-fetch#custom-agent
    var agents = { httpsAgent: this.httpsAgent, httpAgent: this.httpAgent };

    if (this.agent) {
      agents.httpsAgent = this.agent.https;
      agents.httpAgent = this.agent.http;
    }

    if (this.host.substring(0, 5) === "https") {
      options.agent = agents.httpsAgent;
    } else {
      options.agent = agents.httpAgent;
    }
  }

  if (this.headers) {
    this.headers.forEach(function (header) {
      headers[header.name] = header.value;
    });
  }

  // Default headers
  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  // As the Fetch API supports the credentials as following options 'include', 'omit', 'same-origin'
  // https://developer.mozilla.org/en-US/docs/Web/API/fetch#credentials
  // To avoid breaking change in 1.x we override this value based on boolean option.
  if (this.withCredentials) {
    options.credentials = "include";
  } else {
    options.credentials = "omit";
  }

  options.headers = headers;

  if (this.timeout > 0 && typeof controller !== "undefined") {
    this.timeoutId = setTimeout(function () {
      controller.abort();
    }, this.timeout);
  }

  let triedCount = 0;
  let currentHostIndex = 0;
  let host = this.hosts[currentHostIndex];

  const that = this;

  const callToNextHost = function (callbackOutOfTime) {
    currentHostIndex = (currentHostIndex + 1) % that.hosts.length;
    triedCount++;

    if (triedCount < that.hosts.length) {
      host = that.hosts[currentHostIndex];

      if (host && host.includes("krystal.app")) {
        options.headers["X-Client-Type"] = "web";
      } else {
        delete options.headers["X-Client-Type"];
      }
      fetch(host, options).then(success).catch(failed);
    } else {
      callbackOutOfTime && callbackOutOfTime();
    }
    return;
  };

  let prevErrorResponse = "";

  var success = function (response) {
    if (that.timeoutId !== undefined) {
      clearTimeout(that.timeoutId);
    }

    // Response is a stream data so should be awaited for json response
    response
      .json()
      .then(function (data) {
        that.host = host;
        if (!data.error) {
          callback(null, data);
          return;
        }

        if (!data.id) {
          callToNextHost(function () {
            callback(null, data);
          });

          return;
        }

        if (!!data.error.code) {
          if (!!data.error.code.toString().match(/(^5\d{2}$)|401|429|403/gm)) {
            callToNextHost(function () {
              callback(null, data);
            });

            return;
          }

          if (prevErrorResponse === data.error.message) {
            prevErrorResponse = "";
            currentHostIndex = (currentHostIndex - 1) % that.hosts.length;
            triedCount--;
            if (triedCount < that.hosts.length) {
              host = that.hosts[currentHostIndex];

              if (host && that.host.includes("krystal.app")) {
                options.headers["X-Client-Type"] = "web";
              } else {
                delete options.headers["X-Client-Type"];
              }
            }
            callback(null, data);
            return;
          }

          if (!prevErrorResponse) {
            prevErrorResponse = data.error.message;
            callToNextHost(function () {
              callback(null, data);
            });
            return;
          }

          callback(null, data);
        }
      })
      .catch(function () {
        callback({ message: errors.InvalidResponse(response).message, host: host });
      });
  };

  var failed = function (error) {
    if (that.timeoutId !== undefined) {
      clearTimeout(that.timeoutId);
    }
    callToNextHost(function () {
      if (error.name === "AbortError") {
        callback({ message: errors.ConnectionTimeout(that.timeout).message, host: host });
      }

      const connectTimeoutErr = errors.InvalidConnection(that.timeout);
      callback({ message: connectTimeoutErr.message, code: connectTimeoutErr.code, host: host });
    });
  };

  if (host && host.includes("krystal.app")) {
    options.headers["X-Client-Type"] = "web";
  } else {
    delete options.headers["X-Client-Type"];
  }

  fetch(host, options).then(success.bind(this)).catch(failed.bind(this));
};

HttpProvider.prototype.disconnect = function () {
  //NO OP
};

/**
 * Returns the desired boolean.
 *
 * @method supportsSubscriptions
 * @returns {boolean}
 */
HttpProvider.prototype.supportsSubscriptions = function () {
  return false;
};

module.exports = HttpProvider;
