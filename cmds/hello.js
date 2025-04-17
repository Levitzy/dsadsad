module.exports = {
    name: 'hello',
    description: 'Greets the user',
    execute(api, event, args) {
        // Get user info
        api.getUserInfo(event.senderID, (err, userInfo) => {
            if (err) {
                console.error('Error getting user info:', err);
                api.sendMessage('Hello there!', event.threadID, event.messageID);
                return;
            }

            const userName = userInfo[event.senderID].name || 'there';
            api.sendMessage(`Hello ${userName}! How are you today?`, event.threadID, event.messageID);
        });
    }
};