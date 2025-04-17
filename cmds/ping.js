module.exports = {
    name: 'ping',
    description: 'Check if the bot is responding',
    execute(api, event, args) {
        const startTime = Date.now();
        
        api.sendMessage('Pinging...', event.threadID, (err, messageInfo) => {
            if (err) return console.error(err);
            
            const endTime = Date.now();
            const ping = endTime - startTime;
            
            api.sendMessage(`Pong! 🏓 Response time: ${ping}ms`, event.threadID, messageInfo.messageID);
        });
    }
};