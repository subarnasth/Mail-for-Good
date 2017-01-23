require('dotenv').config();
const debug = require('debug')('server:feedback-consumer:index');
const redis = require('redis');
const feedbackConsumer = require('./feedback-consumer');
const Campaign = require('../models').campaign;


var isSending = false;

feedbackConsumer.start();

// Restart the feedback consumers to apply new credentials when
// new settings are received
const subscriber = redis.createClient();
subscriber.on('message', (channel, event) => {
  if (event == 'changed' && !isSending) {
    debug('Got a change-settings event, so restarting consumers to apply new credentials')
    feedbackConsumer.restart();
  }
});
subscriber.subscribe('change-settings');

// Poll the database to check that campaigns are not being sent.
// If a campaign is being sent, stop the feedback consumers
// to speed up email sending (by reducing writes to the database)
// and prevent race conditions caused by receiving a feedback message
// before the messageId has been stored.
const pollingRateMs = 10000;
setInterval(() => {
  Campaign.count({
    where: { status: 'sending' }
  }).then(numSending => {
    if (numSending) {
      debug('%d campaigns are being sent, stopping feedback consumer', numSending);
      isSending = true;
      feedbackConsumer.stop();
    } else {
      debug('No campaigns are being sent, restarting feedback consumer')
      isSending = false;
      feedbackConsumer.start();
    }
  }).catch(err => {
    throw err;
  });
}, pollingRateMs);
