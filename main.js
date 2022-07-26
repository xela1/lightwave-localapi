// Set Group ID
const groupId = '5df8b6728522075debd21ad8'

// Setup Logging
const winston = require('winston');
winston.level = 'debug';
const logConfiguration = {
    'transports': [
        new winston.transports.Console({
            level: 'debug'
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
            console.log(`LW App has sent us: ${event.data}`);
            webSockets['haclient'].send(event.data)
        });
        logger.info(`New Application Client Connected ${ws._socket.remoteAddress}`);
    }
    // sending message
    ws.on("message", data => {
        const messageBody = JSON.parse(data);
        const operation = messageBody.operation
        if (req.url == '/sockets') {
            console.log(`Hub has sent us: ${data}`)
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
                    console.log('event received from Hub')
                    // ws_lw.send(data)
                    messageBody.items.forEach(element => {
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
                        // console.log(responsejson);
                        webSockets['haclient'].send(responsejson)
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

            
        }
        if (req.url == '/') {
            switch(operation) {
                case 'authenticate': // proxy this
                    webSockets['haclient'] = ws
                    logger.info('App Client: Authenticate')
                    logger.debug(`App Client Message: ${data}`)
                    // ws_lw_app.close()
                    // ws_lw_app.open
                    ws_lw_app.send(data)
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