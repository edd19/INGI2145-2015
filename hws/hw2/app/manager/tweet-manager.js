var app = require('../app');
var uuid = require('node-uuid');
var async = require('async');
var findHashtags = require('find-hashtags');



var collectionName = "Tweets";

var upsertTweet = 'INSERT INTO twitter.Tweets (tweetid, author, created_at, body) '
+ 'VALUES(?, ?, ?, ?);';

var openCollection = function(callback) {
  app.db.collection(collectionName, callback);
}

/* add a tweet*/
exports.newTweet = function(data, callback)
{
  data.created_at = new Date();
  data.tweetid = uuid.v1();
  // HINT:
  // The data object at this point contains the new tweeet
  // It has these attributes:
  // - created_at
  // - tweetid
  // - username
  // - name <- this is the fullname of username
  // - body

  // Need to initiate the process that will insert the tweet into the database
  // and process the tweet for the analytics. These can run in parallel, hence
  // we suggest you use async.parallel.
  // This function in the end must call callback(err, data)

  async.parallel([
    // Save the tweet to the database
    function(){
      try {
        app.db.execute(upsertTweet,
          [data.tweetid, data.username, data.created_at, data.body],
          afterExecution('Error: ', 'Tweet ' + data.tweetid +' upserted.'));

          //Gets the users following the user creating the tweet
          var getFollowers = "SELECT * FROM twitter.Users_src_dest WHERE src = ?";
          var followers = [];
          app.db.execute(getFollowers,
                [ data.username ], function(e, result) {
            		if (result.rows.length>0) {//checks if a result has been received
                  for (i =0; i<result.rows.length;i++)//scans through result and adds every element to "followers" list
                  {
                    var upsertTimeline = 'INSERT INTO twitter.Timeline (username, tweetid, author, created_at, body) '
                        + 'VALUES(?, ?, ?, ?, ?);';
                    app.db.execute(upsertTimeline,
                          [result.rows[i].dest, data.tweetid, data.username, data.created_at, data.body],
                          afterExecution('Error: ', 'Timeline ' + followers[i] + ' ' + data.tweetid + ' upserted.'));
                  }
            		}
            	});

        } catch (err) {
          console.log("Error:", err);
        }
      },
      //Parse the hashtag in the tweet if any for the analytics part
      function(){
          var hashtags = findHashtags(data.body);
          console.log(hashtags);
          var kafka = require('kafka-node'),
          Producer = kafka.Producer,
          client = new kafka.Client('localhost:2181/'),
          producer = new Producer(client),
          payloads = [
            { topic: 'test', messages: hashtags, partition: 0 }
          ];
          producer.on('ready', function () {
            producer.send(payloads, function (err, data) {});
            console.log('send', data);
            callback(null, '1');
          });
          producer.on('error', function(err){
            console.error('error while connecting to kafka node: ', err);
            callback(err, null);
          });


      }
    ], function (err, results) { callback(err, data); });
  }
  function afterExecution(errorMessage, successMessage) {
    return function(err, result) {
      if (err) {
        return console.log(errorMessage + err);
      } else {
        return console.log(successMessage);
      }
    }
  }
