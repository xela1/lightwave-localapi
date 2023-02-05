// Set Group ID
var groupId = ''

// Websocket Reconnect
var reconnectInterval = 1000 * 5;

// Get group ID from environment 
var groupIds = process.env.GROUP_ID || "";
if (groupIds.length > 0) { var groupId = groupIds.split('-')[0] }

// local only mode 
const local_only = process.env.LOCAL_ONLY || false;

if (local_only && groupId.length === 0) {
    throw ("Cannot run in local only mode without specifying group ID")
}



// Setup Logging
const { transports, createLogger, format } = require('winston');

const logger = createLogger({
    format: format.combine(
        format.timestamp(),
        format.json()
    ),
    'transports': [
        new transports.Console({
            level: process.env.LOG_LEVEL || 'info'
        }),
        new transports.File({ filename: 'error.log', level: 'error' }),
        new transports.File({ filename: 'debug.log', level: 'debug' })
    ]
});

// Importing the required modules
const WebSocket = require('ws');
const fs = require('fs');
const https = require('https');

// Load Cert
const server = new https.createServer({
    cert: fs.readFileSync('server.cert'),
    key: fs.readFileSync('server.key')
});

// Server API URLS
lw_app_api_url = "wss://v1-linkplus-app.lightwaverf.com"
lw_hub_api_url = "wss://linkplus-pub-api.lightwaverf.com:443/sockets"

// Get Local IP
var ip = require("ip");
const ipaddress = ip.address()

// Initialise Transaction ID
var localHubtransID = 1;

// Initialise Hub Id Variable
var hubId = ""

// Initialise device and feature array
var devices = []

const { cli } = require('winston/lib/winston/config');

// Set up Wait
waitingResponse = [];

// Set up Websockets
webSockets = [];

// Create Hub Client
var connect_ws_lw = function () {
    ws_lw = new WebSocket(lw_hub_api_url, {
        // rejectUnauthorized: false
    });
    ws_lw.on('open', function () {
        ws_lw.id = "LWHUBAPI"
        AppClients.push(ws_lw)
        logger.info("Hub API: Connected");
        if (typeof webSockets['hub'] !== 'undefined' && webSockets['hub']) {
            webSockets['hub'].close();
            logger.info("Hub API: Forcing Hub to reconnect")
        }
        // if (hub_auth) { // If connection is re-established re-send initial hub auth
        //     logger.info("Hub Api: Re-authenticating with Hub API")
        //     logger.debug(`Hub API: sending ${hub_auth} to LW`)
        //     ws_lw.send(hub_auth)
        // }
    });
    ws_lw.on('error', function (event) {
        logger.error("Hub API: Socket Error");
        logger.debug("Hub API:", event)
    });
    ws_lw.on('close', function () {
        logger.error("Hub API: Socket Closed");
        setTimeout(connect_ws_lw, reconnectInterval);
    });
};
connect_ws_lw();

// Auth Variables
var lw_is_auth = false
var hub_auth = ""
var app_auth = ""

var connect_lw_api = function () {
    ws_lw_app = new WebSocket(lw_app_api_url, {
        rejectUnauthorized: false
    });
    ws_lw_app.on('open', function () {
        ws_lw_app.id = "LWAPI"
        AppClients.push(ws_lw_app)
        logger.info("App API: Connected");
        lw_is_auth = false
        if (app_auth) { // If socket is reconnected, attempt to re-auth with saved json
            logger.info("App Api: Re-authenticating with App API")
            ws_lw_app.send(app_auth)
        }
    });
    ws_lw_app.on('error', function (event) {
        logger.info("App API: Socket Error");
        logger.debug("App API:", event)
    });
    ws_lw_app.on('close', function () {
        logger.info("App API: Socket Closed");
        setTimeout(connect_lw_api, reconnectInterval);
    });
};
connect_lw_api();

var webSockets = {} // userID: webSocket

// Creating a new websocket server
const wss = new WebSocket.Server({
    server: server
})

AppClients = [];

wss.getUniqueID = function () {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }
    return s4() + s4() + '-' + s4();
};

// Creating connection using websocket
wss.on("connection", (ws, req) => {
    ws.id = wss.getUniqueID();
    if (req.url == '/sockets') { // if hub connects, open new connection to LW
        ws_lw.addEventListener('message', function (event) { // Messages from Hub API
            const messageBody = JSON.parse(event.data);
            switch (messageBody.operation) {
                case 'write':
                    logger.debug(`Hub Api: LW has sent us: ${event.data}`)
                    featureId = messageBody.items[0].payload.featureId
                    value = messageBody.items[0].payload.value
                    logger.info(`Hub API: LW has requested Feature ${featureId} to be set to ${value}`)
                    messageBody.transactionId = messageBody.items[0].itemId
                    sendtoHub('LWHUBAPI', messageBody)
                    break;
                case 'read':
                    logger.debug(`Hub Api: LW has sent us: ${event.data}`)
                    featureId = messageBody.items[0].payload.featureId
                    logger.info(`Hub API: LW has requested read on Feature ${featureId}`)
                    messageBody.transactionId = messageBody.items[0].itemId
                    sendtoHub('LWHUBAPI', messageBody)
                    break;
                case 'authenticate':
                    logger.debug(`Hub API: LW has sent us: ${event.data}`);
                    if (messageBody.items[0].success == true) {
                        logger.info("Hub API: Hub Successfully Authenticated")
                    }
                    else {
                        logger.error("Hub API: Hub Authentication Failed")
                    }
                    sendtoHub('LWHUBAPI', messageBody)
                    break;
                default:
                    logger.info(`Hub API: LW has sent us: ${event.data}`);
                    sendtoHub('LWHUBAPI', messageBody)
                    break;
            }

        });
        webSockets['hub'] = ws
        logger.info(`Hub: New Hub Connection from ${ws._socket.remoteAddress}`);
    }
    if (req.url == '/') {
        ws_lw_app.addEventListener('message', function (event) { // Messages from LW API
            const messageBody = JSON.parse(event.data);
            switch (messageBody.operation) {
                case 'authenticate':
                    logger.debug(`App Api: LW App has sent us: ${event.data}`)
                    if (messageBody.items[0].success == true) { // Successfully authed with LW API
                        lw_is_auth = true
                        logger.info("App Api: Successfully Authenticated with LW")
                        // Lets request groups from LW rather than waiting for them (if we restart the local API, the client doesnt request them)
                        if (groupId.length === 0) {
                            var group_json = '{"class":"user","operation":"rootGroups","version":1,"senderId":"29db9beb-fb3f-475c-929c-68eaa21ea80e","transactionId":"a","direction":"request","items":[{"itemId":0,"payload":{}}]}'
                            sendtoLW(0, JSON.parse(group_json))
                        }
                    } else if (messageBody.items[0]["error"]["code"] == "200") {
                        logger.info("App Api: Already authenticated")
                    } else {
                        logger.info("App Api: Authentication Failed")
                    }
                    if (typeof waitingResponse[messageBody.transactionId] !== 'undefined') {
                        logger.info(`App Api: Received response from LW App for transaction ${messageBody.transactionId} sending to client ${waitingResponse[messageBody.transactionId]}`)
                        authClient(waitingResponse[messageBody.transactionId])
                        sendtoClient(waitingResponse[messageBody.transactionId], messageBody)
                    } else {
                        logger.debug(`Hub: Received unexpected response ${event.data}`)
                    }
                    break;
                case 'rootGroups':
                    logger.debug(`App Api: LW App has sent us: ${event.data}`)
                    groupIds = messageBody.items[0].payload.groupIds[0]
                    groupId = groupIds.split('-')[0]
                    logger.info(`App Api: Group ID ${groupId} received`)
                    if (messageBody.transactionId != "a") {
                        if (typeof waitingResponse[messageBody.transactionId] !== 'undefined') {
                            logger.info(`App Api: Received response from LW App for transaction ${messageBody.transactionId} sending to client ${waitingResponse[messageBody.transactionId]}`)
                            sendtoClient(waitingResponse[messageBody.transactionId], messageBody)
                        } else {
                            logger.debug(`App Api: Received unexpected response ${event.data}`)
                        }
                    }
                    break;
                case 'event': // only send the event to the clients if we don't have a groupID (shouldnt happen now)
                    if (groupId.length === 0) {
                        logger.debug(`Hub API: LW has sent us: ${event.data}`);
                        sendAll(messageBody)
                    }
                    break;
                case 'read':
                    if (messageBody.class == 'group') { //response to a group request
                        if (messageBody.transactionId != 0) {
                            if (typeof waitingResponse[messageBody.transactionId] !== 'undefined') {
                                logger.info(`App Api: Received response from LW App for transaction ${messageBody.transactionId} sending to client ${waitingResponse[messageBody.transactionId]}`)
                                sendtoClient(waitingResponse[messageBody.transactionId], messageBody)
                            } else {
                                logger.debug(`App Api: Received unexpected response ${event.data}`)
                            }
                        }
                    }
                    break;
                default:
                    if ((messageBody.items[0].success == false) && (messageBody.items[0].error.code == "200")) {
                        lw_is_auth = false
                        logger.error("App Api: Error, not authenticated with LW")
                    }
                    logger.error(`App Api: LW has sent us unhandled data: ${event.data}`);
                    break;
            }
        });
        AppClients.push(ws);
        logger.info(`New Application Client Connected ${ws._socket.remoteAddress} ${ws.id}`);
    }
    // Client sending message
    ws.on("message", data => {
        const messageBody = JSON.parse(data);
        const operation = messageBody.operation
        if (req.url == '/sockets') { // Message from Hub
            logger.debug(`Hub: Hub has sent us: ${data}`)
            switch (operation) {
                case 'authenticate':
                    hubId = messageBody.senderId
                    if (local_only == false) {
                        hub_auth = data
                        logger.info("Hub: Authenticating with Lightwave")
                        logger.debug(`Hub: Sending ${data} to LW`)
                        ws_lw.send(data)
                    } else {
                        var response = {}
                        response['version'] = messageBody.version
                        response['senderId'] = "1.ip=" + ip.address()
                        response['direction'] = "response"
                        response['source'] = "webSocket"
                        response['items'] = [];
                        element = {}
                        element['itemId'] = messageBody.items[0].itemId
                        element['success'] = true;
                        element['payload'] = {}
                        element['payload']['workerUniqueId'] = ip.address()
                        element['payload']['serverName'] = ip.address()
                        element['payload']['connection'] = "accepted"
                        response['items'].push(element)
                        response['class'] = "system"
                        response['operation'] = "authenticate"
                        response['transactionId'] = messageBody.transactionId
                        responsejson = JSON.stringify(response);
                        sendtoHub('Local', response)
                        requestItems()
                    }
                    break;
                case 'event':
                    if (local_only == false) { sendtoClient('LWHUBAPI', messageBody) }// Send the original event to the HUB API 
                    messageBody.items.forEach(element => {
                        logger.info(`Event received from Hub - Feature ${element['payload']['featureId']} - Value ${element['payload']['value']} `)
                        var response = {}
                        response['version'] = messageBody.version
                        response['senderId'] = messageBody.senderId
                        response['transactionId'] = messageBody.transactionId
                        response['direction'] = 'notification'
                        response['class'] = messageBody.class
                        response['operation'] = messageBody.operation
                        response['items'] = [];
                        element['payload']['featureId'] = groupId + '-' + element['payload']['featureId'] + '-' + messageBody.senderId + '+1'
                        element['success'] = 'true'
                        response['items'].push(element)
                        responsejson = JSON.stringify(response);
                        if (groupId) { // can't send event without the GroupID so we'll need to get LW to do it
                            sendAll(responsejson)
                        }
                    });
                    break;
                case 'write': // response from hub for feature write
                    clientId = messageBody.items[0].itemId
                    if (typeof waitingResponse[clientId] !== 'undefined') {
                        logger.info(`Hub: Received response from hub for transaction ${clientId} sending to client ${waitingResponse[clientId]}`)
                        // HA expects the transaction ID to be the same as itemId
                        if (waitingResponse[clientId] != 'LWHUBAPI') { messageBody.transactionId = messageBody.items[0].itemId }
                        sendtoClient(waitingResponse[clientId], messageBody)
                    } else {
                        logger.debug(`Hub: Received unexpected response ${data}`)
                    }
                    break;
                case 'read':
                    clientId = messageBody.items[0].itemId
                    if (typeof waitingResponse[clientId] !== 'undefined') {
                        if (waitingResponse[clientId] == "Local") {
                            logger.info(`Hub: Received device information for ${messageBody.items[0]['payload']['deviceId']}`)
                            devices[messageBody.items[0]['payload']['deviceId']] = messageBody.items[0]['payload']
                        } else {
                            logger.info(`Hub: Received response from hub for transaction ${clientId} sending to client ${waitingResponse[clientId]}`)
                            // HA expects the transaction ID to be the same as itemId
                            if (waitingResponse[clientId] != 'LWHUBAPI') { messageBody.transactionId = messageBody.items[0].itemId }
                            sendtoClient(waitingResponse[clientId], messageBody)
                        }
                    } else {
                        logger.debug(`Hub: Received unexpected response ${data}`)
                    }
                    break;
                case 'list':
                    if (local_only == false) {
                        sendtoClient('LWHUBAPI', messageBody)
                    } else {
                        getFeatures(messageBody['items'][0]['payload']['deviceIds'])
                    }
                    break;
                default:
                    logger.error(`Hub: Unhandled operation: ${data}`)
                    sendtoClient('LWHUBAPI', messageBody)
                    break;
            }

        }
        if (req.url == '/') { // Message from HA
            switch (operation) {
                case 'authenticate': // proxy this if not local mode or already authd
                    logger.info('App Client: Requested Authenticate')
                    logger.debug(`App Client Message: ${data}`)
                    app_auth = data
                    if (lw_is_auth == false && local_only == false) {
                        sendtoLW(ws.id, messageBody)
                    } else { // tell the client it's authorised
                        auth_json = '{"version":1,"senderId":"1.ip=10=192=22=140*eu=west=1*compute*internal=82149","direction":"response","source":"_channel","items":[{"itemId":0,"success":true,"payload":{"workerUniqueId":"ip=10=192=22=140*eu=west=1*compute*internal=82149","serverName":"i-0b3c24bf89033f71e","handlerId":"user.7aa9ada8-9914-4f8f-9bd4-80f85593a54b.eb0d95dc-83f5-4b3c-9691-dcdbe9315987"}}],"class":"user","operation":"authenticate","transactionId":1}';
                        auth_json_parsed = JSON.parse(auth_json);
                        auth_json_parsed.transactionId = messageBody.transactionId
                        auth_json_parsed.items[0].itemId = messageBody.transactionId
                        auth_json_parsed.senderId = "1.ip=" + ip.address()
                        auth_json_parsed.items[0].payload.workerUniqueId = ip.address()
                        handlerId = auth_json_parsed.items[0].payload.handlerId
                        handlerId = handlerId.split(".")[0] + '.' + handlerId.split(".")[1] + '.' + messageBody.items[0].payload.clientDeviceId
                        auth_json_parsed.items[0].payload.handlerId = handlerId
                        response_json = JSON.stringify(auth_json_parsed);
                        logger.info('App: Sending Auth Response to App')
                        logger.debug(`App: Auth Response ${response_json}`)
                        authClient(ws.id)
                        sendtoClient(ws.id, auth_json_parsed)
                    }
                    break;
                case 'read': // HA requesting state
                    if (messageBody.class == 'feature') { // Send feature request direct to hub
                        logger.debug(`App: App has sent us: ${data}`)
                        // extract featureId from JSON
                        featureId = messageBody.items[0].payload.featureId.split('-')[1]
                        // Get the HUB Id from JSON
                        hub = messageBody.items[0].payload.featureId.split('-')[2].substring(0, messageBody.items[0].payload.featureId.split('-')[2].length - 2)
                        logger.info(`App: App has requested read on function ${featureId} Transaction ${messageBody.transactionId}`)
                        // Replace featureId                        
                        messageBody.items[0].payload.featureId = parseInt(featureId)
                        sendtoHub(ws.id, messageBody)
                    } else if (messageBody.class == 'group') {
                        if (local_only == false) { sendtoLW(ws.id, messageBody) } else {
                            sendgroups(ws.id, messageBody);
                        }
                    }
                    break;
                case 'rootGroups': // proxy this if we've not already got the group ID
                    if (groupId.length === 0) {
                        sendtoLW(ws.id, messageBody)
                    } else {
                        rootgroups_json = '{"version":1,"senderId":"1.ip=10=192=21=210*eu=west=1*compute*internal=23804","direction":"response","source":"_channel","items":[{"itemId":1,"success":true,"payload":{"groupIds":[""],"rootGroups":[{"rootGroupId":"","name":"My Group"}]}}],"class":"user","operation":"rootGroups","transactionId":1}';
                        rootgroups_json_parsed = JSON.parse(rootgroups_json);
                        rootgroups_json_parsed.transactionId = messageBody.transactionId
                        rootgroups_json_parsed.items[0].itemId = messageBody.transactionId
                        rootgroups_json_parsed.senderId = "1.ip=" + ip.address()
                        rootgroups_json_parsed.items[0].payload.groupIds[0] = groupIds
                        rootgroups_json_parsed.items[0].payload.rootGroups[0].rootGroupId = groupIds
                        response_json = JSON.stringify(rootgroups_json_parsed);
                        logger.info('App: Sending Root Groups to App')
                        logger.debug(`App: Root Groups ${response_json}`)
                        sendtoClient(ws.id, rootgroups_json_parsed)
                    }
                    break;
                case 'write': // send direct to hub, bypassing Lightwave
                    // get Hub ID from feature
                    hub = messageBody.items[0].payload.featureId.split('-')[2].substring(0, messageBody.items[0].payload.featureId.split('-')[2].length - 2)
                    message = messageBody
                    // Only send the feature ID, not the groups or hub ID
                    message.items[0].payload.featureId = parseInt(message.items[0].payload.featureId.split("-")[1])
                    // We don't want to send the request if the hub isnt connected
                    sendtoHub(ws.id, message)
                    logger.info(`App: App has requested write on feature ${message.items[0].payload.featureId} Transaction ${messageBody.transactionId}`)
                    logger.debug(`App: App has sent us: ${data}`)
                    break;
                case 'tohub':
                    message = messageBody
                    message.operation = message.realoperation;
                    delete message.realoperation
                    sendtoHub(ws.id, message)
                default:
                    logger.info(`App: App has sent us: ${data}`)
                    break;
            }
        }

    });
    // handling what to do when clients disconnects from server
    ws.on("close", () => {
        logger.info(`Client ${ws.id} has disconnected`);
        RemoveClient(ws.id)
    });
    // handling client connection error
    ws.onerror = function () {
        logger.info("Some Error occurred")
    }
});
server.listen(443);
logger.info(`The WebSocket server is running on port ${server.address().port}`)

function sendgroups(clientid, messageBody) {
    message = {};
    message['version'] = 1;
    message['senderId'] = "1.ip=" + ipaddress;
    message['direction'] = "response";
    message['source'] = "_channel";
    message['items'] = [];
    item = {};
    item['itemId'] = messageBody['transactionId'];
    item['success'] = true;
    item['payload'] = {};
    item['payload']['groupId'] = groupIds;
    item['payload']['name'] = "My Group";
    item['payload']['type'] = "root";
    item['payload']['parents'] = [];
    item['payload']['devices'] = {};
    item['payload']['features'] = {};
    devices.forEach(device => {
        deviceid = groupId + "-" + device['deviceId'] + "-" + hubId + "+1";
        item['payload']['devices'][deviceid] = {};
        item['payload']['devices'][deviceid]['deviceId'] = deviceid;
        item['payload']['devices'][deviceid]['name'] = device['name'];
        item['payload']['devices'][deviceid]['paired'] = true;
        item['payload']['devices'][deviceid]['productCode'] = device['productCode'];
        if (device['createdTime'] > 0) {
            createdDate = new Date(device['createdTime'] * 1000).toJSON();
        } else createdDate = '';
        item['payload']['devices'][deviceid]['createdDate'] = createdDate;
        item['payload']['devices'][deviceid]['featureIds'] = [];
        Object.keys(device['features']).forEach(function (key) {
            featureId = groupId + "-" + device['features'][key]['featureId'] + "-" + hubId + "+1";
            // add features to device
            item['payload']['devices'][deviceid]['featureIds'].push(featureId);
            // create feature
            item['payload']['features'][featureId] = {};
            item['payload']['features'][featureId]['featureId'] = featureId;
            item['payload']['features'][featureId]['name'] = device['name'];
            item['payload']['features'][featureId]['deviceId'] = deviceid;
            item['payload']['features'][featureId]['groups'] = [groupIds];
            item['payload']['features'][featureId]['createdDate'] = createdDate;
            item['payload']['features'][featureId]['attributes'] = {};
            item['payload']['features'][featureId]['attributes']['featureId'] = device['features'][key]['featureId'];
            item['payload']['features'][featureId]['attributes']['writable'] = device['features'][key]['writable'];
            item['payload']['features'][featureId]['attributes']['channel'] = device['features'][key]['channel'];
            item['payload']['features'][featureId]['attributes']['type'] = device['features'][key]['type'];
            item['payload']['features'][featureId]['attributes']['status'] = device['features'][key]['status'];
            item['payload']['features'][featureId]['attributes']['name'] = device['name'];
        });
    })
    message['items'].push(item)
    message['class'] = "group";
    message['operation'] = "read";
    message['transactionId'] = messageBody['transactionId'];
    sendtoClient(clientid, message)
    logger.info('Local Hub: Sending groups to client')
}


function getHubTransactionId() {
    Id = localHubtransID
    localHubtransID++
    return Id
}

function getFeatures(deviceIds) {
    deviceIds.forEach(element => {
        transID = getHubTransactionId()
        message = {}
        message['version'] = 1;
        message['senderId'] = `1.ip=${ipaddress}`
        message['transactionId'] = transID
        message['direction'] = "request"
        message['class'] = "device"
        message['operation'] = "read"
        message['items'] = []
        item = {}
        item['payload'] = {}
        item['payload']['deviceId'] = element
        item['itemId'] = transID
        message['items'].push(item)
        sendtoHub('Local', message)
    })
}

function requestItems() {
    transID = getHubTransactionId()
    message = {}
    message['version'] = 1;
    message['senderId'] = `1.ip=${ipaddress}`
    message['transactionId'] = transID
    message['direction'] = "request"
    message['class'] = "device"
    message['operation'] = "list"
    message['items'] = []
    item = {}
    item['payload'] = {}
    item['payload']['destinationId'] = hubId.toString()
    item['itemId'] = transID
    message['items'].push(item)
    logger.info('Local Hub: Requesting Items from Hub')
    sendtoHub('Local', message)
}


function RemoveClient(clientId) {
    if (webSockets['hub'].id == clientId) {
        webSockets = []
    } else {
        for (var i = 0; i < AppClients.length; i++) {
            if (AppClients[i].id == clientId) {
                AppClients.splice(i, 1)
            }
        }
    }
}

function authClient(clientId) {
    var success = false
    for (var i = 0; i < AppClients.length; i++) {
        if (AppClients[i].id == clientId) {
            logger.debug(`Client: Marking ${clientId} as auth'd`)
            AppClients[i].is_auth = true;
            success = true
        }
    }
    if (success != true) {
        logger.error(`App: Client with ID ${clientId} not found`)
    }
}


function sendAll(message) {
    for (var i = 0; i < AppClients.length; i++) {
        if ((AppClients[i].id != 'LWAPI') && (AppClients[i].id != 'LWHUBAPI') && (AppClients[i].is_auth == true)) {
            logger.debug(`Broadcast: Sending ${message} to ${AppClients[i].id}`)
            AppClients[i].send(message);
        }
    }
}

function sendtoClient(clientId, message) {
    var success = false
    for (var i = 0; i < AppClients.length; i++) {
        if (AppClients[i].id == clientId) {
            logger.debug(`Client: Sending ${JSON.stringify(message)} to ${clientId}`)
            AppClients[i].send(JSON.stringify(message));
            success = true
        }
    }
    if (success != true) {
        logger.error(`App: Client with ID ${clientId} not found`)
    }
}

function sendtoLW(clientId, message) {
    waitingResponse[message.transactionId] = clientId
    sendtoClient("LWAPI", message)
}

function sendtoHub(clientId, message) {
    waitingResponse[message.transactionId] = clientId
    if (webSockets['hub']) {
        logger.debug(`Hub: Sending ${JSON.stringify(message)} to ${clientId}`)
        webSockets['hub'].send(JSON.stringify(message))
    } else {
        logger.error("Hub: Error Hub not connected")
    }
}

process.on('SIGINT', function () {
    logger.info("Caught interrupt signal");
    process.exit();
});
