const AWS = require('aws-sdk');
const Consumer = require('sqs-consumer');
require('dotenv').config();
const {
  sequelize,
  setting: Settings,
  campaignsubscriber: CampaignSubscriber,
  campaignanalytics: CampaignAnalytics,
  listsubscriber: ListSubscriber
} = require('./models');

start();

function start() {
  setupConsumers();
}

function setupConsumers() {
  let consumers = [];

  Settings.findAll({  // (might be safer to find settings through user join)
    // Add settings validation
    raw: true
  }).then(settings => {
    settings.forEach(setting => {
      consumers.push(createConsumer(setting.region, setting.amazonSimpleEmailServiceAccessKey, setting.amazonSimpleEmailServiceSecretKey, setting.amazonSimpleQueueServiceUrl));
    });

    consumers.forEach(consumer => {
      consumer.start();
    });
  }).catch(err => {
    throw err;
  });
}

function createConsumer(region, accessKeyId, secretAccessKey, queueUrl) {
  // Create a consumer that processes email feedback notifications from an SQS queue
  return Consumer.create({
    queueUrl,
    batchSize: 10,
    handleMessage: receiveMessageCallback,
    sqs: new AWS.SQS({ accessKeyId, secretAccessKey, region })
  });
}

function receiveMessageCallback(message, done) {
  // Perform overly complicated parsing of an SES feedback notification/message
  // and save the results to the database

  // Extract the SES email feedback notification
  // See example data structure: https://docs.aws.amazon.com/ses/latest/DeveloperGuide/notification-examples.html
  const email = JSON.parse(JSON.parse(message.Body).Message);

  // Check that the notification is valid
  if (email && email.notificationType && email.mail && email.mail.messageId) {

    // Construct the fields to update (status and bounceType)
    const notificationType = email.notificationType
    let bounceType = '';
    let bounceSubType = '';
    if (notificationType === 'Bounce' && email.bounce) {
      bounceType = email.bounce.bounceType;
      bounceSubType = email.bounce.bounceSubType;
    }

    // Attempt to update the CampaignSubscriber (sent email) record with the
    // feedback data we've just extracted above.
    CampaignSubscriber.update (
      { status: notificationType, bounceType, bounceSubType },
      {
        where: { messageId: email.mail.messageId },
        returning: true  // Returns
      }
    ).then(result => {
      if (result[0]) {
        const updatedCampaignSubscriber = result[1][0];

        // Now we increment the count of bounces/complaints appropriately
        // This allows us to quickly lookup summary delivery data for multiple campaigns
        // without having to use an expensive SQL COUNT

        // Construct the increment query
        let incrementField = '';
        let recentStatus = 'unconfirmed';
        if (notificationType === 'Bounce') {
          recentStatus = 'bounce:';
          if (bounceType === 'Permanent') {
            incrementField = 'permanentBounceCount'
            recentStatus += 'permanent';
          } else if (bounceType === 'Transient') {
            incrementField = 'transientBounceCount';
            recentStatus += 'transient';
          } else {
            incrementField = 'undeterminedBounceCount';
            recentStatus = 'undetermined';
          }
        } else if (notificationType === 'Complaint') {
          incrementField = 'complaintCount'
          recentStatus = 'complaint';
        }

        if (incrementField) {
          CampaignAnalytics.findOne({
            where: { campaignId: updatedCampaignSubscriber.dataValues.campaignId }
          }).then(ParentCampaignAnalytics => {
            return ParentCampaignAnalytics.increment(incrementField);
          }).then(result => {
            return ListSubscriber.findById(updatedCampaignSubscriber.dataValues.listsubscriberId)
          }).then(listSubscriber => {
            listSubscriber.mostRecentStatus = recentStatus;
            return listSubscriber.save();
          }).then(result => {
            // alkjdlkjf
          }).catch(err => {
            throw err;
          });
        }
        done();
      } else {
        // Skip to deleting the SQS message if the messageId is invalid
        // (i.e. doesn't correspond to a CampaignSubscriber entry).
        // This might happen if the CampaignSubscriber rows were deleted
        // or the database reset while there were still
        done();
      }
    }).catch(err => {
      throw err;
    })
  }
}
