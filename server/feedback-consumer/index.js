const debug = require('debug')('server:feedback-consumer:index');
const feedbackConsumer = require('./feedback-consumer');

feedbackConsumer.start();
