require('dotenv').config();
const debug = require('debug')('server:feedback-consumer:index');
const redis = require('redis');
const feedbackConsumer = require('./feedback-consumer');

feedbackConsumer.start();

// Restart the feedback consumers to apply new credentials when
// new settings are received
const subscriber = redis.createClient();
subscriber.on('message', (channel, event) => {
  if (event == 'changed') {
    debug('Got a change-settings event, so restarting consumers to apply new credentials')
    feedbackConsumer.restart();
  };
})

subscriber.subscribe('change-settings');
