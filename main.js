// Set Group ID
var groupId = ''

// Setup Logging
const winston = require('winston');
winston.level = 'debug';
const logConfiguration = {
    'transports': [
        new winston.transports.Console({
            level: 'info'
        })
    ]
};
const logger = winston.createLogger(logConfiguration);

// Importing the required modules
const WebSocket = require('ws');
const fs = require('fs');
const https = require('https');

// Load Cert
const server = new https.createServer({
    cert: fs.readFileSync('server.cert'),
    key: fs.readFileSync('server.key')
});

// Create Hub Client
const ws_lw = new WebSocket("wss://linkplus-pub-api.lightwaverf.com:443/sockets");
ws_lw.addEventListener("open", () =>{
    logger.info("We are connected to Hub API");
});

// Create App Client
const ws_lw_app = new WebSocket("wss://v1-linkplus-app.lightwaverf.com");
var lw_is_auth = false
ws_lw_app.addEventListener("open", () =>{
    logger.info("We are connected to App API");
});

var webSockets = {} // userID: webSocket

// Creating a new websocket server
const wss = new WebSocket.Server({ 
    server: server
 })
 
// Creating connection using websocket
wss.on("connection", (ws, req) => {
    if (req.url == '/sockets') { // if hub connects, open new connection to LW
        ws_lw.addEventListener('message', function (event) {
            console.log(`LW has sent us: ${event.data}`);
            ws.send(event.data)
        });
        console.log(`New Hub Connection from ${ws._socket.remoteAddress}`);
    }
    if (req.url == '/') {
        ws_lw_app.addEventListener('message', function (event) {
            const messageBody = JSON.parse(event.data);
            switch(messageBody.operation) {
                case 'authenticate':
                    logger.debug(`LW App has sent us: ${event.data}`)
                    if (messageBody.items[0].success == true) { // Successfully authed with LW API
                        lw_is_auth = true
                        logger.info("Successfully Authenticated with LW")
                        // Lets request groups from LW rather than waiting for them
                        var group_json='{"class":"user","operation":"rootGroups","version":1,"senderId":"29db9beb-fb3f-475c-929c-68eaa21ea80e","transactionId":1,"direction":"request","items":[{"itemId":1,"payload":{}}]}'
                        ws_lw_app.send(group_json)
                    }
                    break;
                case 'rootGroups':
                    logger.debug(`LW App has sent us: ${event.data}`)
                    groupIds=messageBody.items[0].payload.groupIds[0]
                    groupId=groupIds.split('-')[0]
                    logger.info(`Group ID ${groupId} received`)
                    break;
                default:
                    if ((messageBody.items[0].success == false) && (messageBody.items[0].error.code == "200")) {
                        lw_is_auth = false
                        logger.info("Error, not authenticated with LW")
                    }
                    logger.debug(`LW App has sent us: ${event.data}`);
                    break;
            }
            if (webSockets['haclient']) {
                webSockets['haclient'].send(event.data)
            }
        });
        logger.info(`New Application Client Connected ${ws._socket.remoteAddress}`);
    }
    // sending message
    ws.on("message", data => {
        const messageBody = JSON.parse(data);
        const operation = messageBody.operation
        if (req.url == '/sockets') {
            switch(operation) {
                case 'authenticate':
                    webSockets[messageBody.senderId] = ws
                    ws_lw.send(data)
                    // // Replace featureId
                    // messageBody.items[0].payload.configNumber=1836
                    // fwdMessage = JSON.stringify(messageBody)
                    // ws_lw.send(fwdMessage)
                    break;
                case 'event':
                    messageBody.items.forEach(element => {
                        logger.info(`Event received from Hub - Feature ${element['payload']['featureId']} - Value ${element['payload']['value']} `)
                        var response = {}
                        response['version']=messageBody.version
                        response['senderId']=messageBody.senderId
                        response['transactionId']=messageBody.transactionId
                        response['direction']='notification'
                        response['class']=messageBody.class
                        response['operation']=messageBody.operation
                        response['items'] = [];
                        element['payload']['featureId'] = groupId + '-' + element['payload']['featureId'] + '-' + messageBody.senderId + '+1'
                        element['success'] = 'true'
                        response['items'].push(element)
                        responsejson = JSON.stringify(response);
                        if (groupId) { // can't send event without the GroupID so we'll need to get LW to do it
                            if (webSockets['haclient']) {
                                webSockets['haclient'].send(responsejson)
                            } else {
                                logger.info("No clients connected, not sending events")
                            }
                        } else { // not received groupId yet, send to LW API to deal with
                            ws_lw.send(data)
                        }
                    });
                    break;
                case 'write':
                    // webSockets['haclient'].send(data)
                    ws_lw.send(data)
                    break;
                case 'read':
                    // webSockets['haclient'].send(data)
                    ws_lw.send(data)
                    break;
                default:
                    
                    ws_lw.send(data)
                    break;
            }
            logger.debug(`Hub has sent us: ${data}`)
            
        }
        if (req.url == '/') {
            switch(operation) {
                case 'authenticate': // proxy this
                    webSockets['haclient'] = ws
                    logger.info('App Client: Requested Authenticate')
                    logger.debug(`App Client Message: ${data}`)
                    if (lw_is_auth == false) {
                        ws_lw_app.send(data)
                    } else {
                        auth_json = '{"version":1,"senderId":"1.ip=10=192=22=140*eu=west=1*compute*internal=82149","direction":"response","source":"_channel","items":[{"itemId":0,"success":true,"payload":{"workerUniqueId":"ip=10=192=22=140*eu=west=1*compute*internal=82149","serverName":"i-0b3c24bf89033f71e","handlerId":"user.7aa9ada8-9914-4f8f-9bd4-80f85593a54b.eb0d95dc-83f5-4b3c-9691-dcdbe9315987"}}],"class":"user","operation":"authenticate","transactionId":1}';
                        auth_json_parsed = JSON.parse(auth_json);
                        auth_json_parsed.transactionId = messageBody.transactionId
                        response_json = JSON.stringify(auth_json_parsed);
                        webSockets['haclient'].send(response_json)
                    }               
                    break;
                case 'read': // HA requesting state
                    if (messageBody.class == 'feature') { // Send feature request direct to hub
                        // // extract featureId from JSON
                        // featureId=messageBody.items[0].payload.featureId.split('-')[1]
                        // // Get the HUB Id from JSON
                        // hub = messageBody.items[0].payload.featureId.split('-')[2].substring(0,messageBody.items[0].payload.featureId.split('-')[2].length-2)
                        // // Replace featureId
                        // messageBody.items[0].payload.featureId=parseInt(featureId)
                        // // Convert back to JSON string
                        // fwdMessage = JSON.stringify(messageBody)
                        // // Forward Message to Hub
                        // webSockets[hub].send(fwdMessage)
                        ws_lw_app.send(data)
                    } else if (messageBody.class == 'group') {
                        ws_lw_app.send(data)
                    }
                    break;
                case 'rootGroups': // proxy this
                    ws_lw_app.send(data)
                    break;
                case 'write': // proxy this for now
                    ws_lw_app.send(data)
                    break;                    
                default:
                    console.log(`App has sent us: ${data}`)
                    break;
            }
        }

    });
    // handling what to do when clients disconnects from server
    ws.on("close", () => {
        console.log("the client has disconnected");
    });
    // handling client connection error
    ws.onerror = function () {
        console.log("Some Error occurred")
    }
});
server.listen(443);
logger.info(`The WebSocket server is running on port ${server.address().port}`)

process.on('SIGINT', function() {
    logger.info("Caught interrupt signal");
    process.exit();
});