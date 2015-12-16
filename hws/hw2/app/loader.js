var bodyParser = require('body-parser');
var cassandra = require('cassandra-driver');
var async = require('async');
var uuid = require('node-uuid');
var fs = require('fs');
var byline = require('byline');
var crypto    = require('crypto');
var AM = require('./manager/account-manager.js');
var booleanContinue = 0;
var once = false;


var client = new cassandra.Client( { contactPoints : [ '127.0.0.1' ] } );
client.connect(function(err, result) {
    console.log('Connected.');
});

async.series([
    function connect(next) {
        client.connect(next);
    },
    function dropKeyspace(next) {
        var query = "DROP KEYSPACE IF EXISTS twitter;";
        client.execute(query, next);
    },
    function createKeyspace(next) {
        var query = "CREATE KEYSPACE IF NOT EXISTS twitter WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '3' };";
        client.execute(query, next);
    },
    function createUserTable(next) {
        var query = 'CREATE TABLE IF NOT EXISTS twitter.Users (' +
                    'username varchar PRIMARY KEY,' +
                    'name text,' +
                    'pass text);';
        client.execute(query, next);
    },
    function createTweetTable(next) {
        var query = 'CREATE TABLE IF NOT EXISTS twitter.Tweets (' +
                    'tweetid uuid,' +
                    'author varchar,' +
                    'created_at timestamp,' +
                    'body text,' +
                    'PRIMARY KEY (author, tweetid) );';
        client.execute(query, next);
    },
    function createTimelineTable(next) {
        var query = 'CREATE TABLE IF NOT EXISTS twitter.Timeline (' +
                    'username varchar,' +
                    'tweetid uuid,' +
                    'author varchar,' +
                    'created_at timestamp,' +
                    'body text,' +
                    'PRIMARY KEY (username, created_at) );'
        client.execute(query, next);
    },
    //Where Src is followed by Dest
    function createUsersSrcDestTable(next) {
        var query = 'CREATE TABLE IF NOT EXISTS twitter.Users_src_dest (' +
                    'src varchar,' +
                    'dest varchar,' +
                    'PRIMARY KEY (src, dest) );'
        client.execute(query, next);
    },
    //Where Dest is following Src
    function createUsersDestSrcTable(next) {
        var query = 'CREATE TABLE IF NOT EXISTS twitter.Users_dest_src (' +
                    'dest varchar ,'+
                    'src varchar,' +
                    'PRIMARY KEY (dest, src) );'
        client.execute(query, next);
    },


    /////////
    // HINT: CREATE ALL YOUR OTHER TABLES HERE
    /////////

    function insertUsers(next)
    {
        /* private encryption & validation methods */
        // To insert same password "test" for all the users
        var generateSalt = function()
        {
            var set = '0123456789abcdefghijklmnopqurstuvwxyzABCDEFGHIJKLMNOPQURSTUVWXYZ';
            var salt = '';
            for (var i = 0; i < 10; i++) {
                var p = Math.floor(Math.random() * set.length);
                salt += set[p];
            }
            return salt;
        }

        var md5 = function(str) {
            return crypto.createHash('md5').update(str).digest('hex');
        }

        var saltAndHash = function(pass, callback)
        {
            var salt = generateSalt();
            callback(salt + md5(pass + salt));
        }

        var upsertUser = 'INSERT INTO twitter.Users (username, name, pass) '
            + 'VALUES(?, ?, ?);';
        var upsertSrcDest = 'INSERT INTO twitter.Users_src_dest (src, dest) '
            + 'VALUES(?, ?);';
        var upsertDestSrc = 'INSERT INTO twitter.Users_dest_src (dest, src) '
            + 'VALUES(?, ?);';

        var u = byline(fs.createReadStream(__dirname + '/users.json'));
        u.on('data', function(line) {
            try {
                var obj = JSON.parse(line);
                saltAndHash("test", function(pass) {
                    obj.pass = pass;
                    client.execute(upsertUser,
                        [obj.username, obj.fullname, obj.pass],
                        afterExecution('Error: ', 'User ' + obj.username + ' upserted.'));
                        //Update edges
                    for (var i in obj.followers) {
                      client.execute(upsertSrcDest,
                          [obj.username, obj.followers[i]],
                          afterExecutionBis('Error: ', 'Users_src_dest ' + obj.username + ' ' + i +' upserted.'));
                      client.execute(upsertDestSrc,
                          [obj.followers[i], obj.username],
                          afterExecutionBis('Error: ', 'Users_dest_src '+ i + ' ' +obj.username + ' upserted.'));
                    }
                });
            } catch (err) {
                console.log("Error:", err);
            }
        });
        u.on('end', next);
    }
], afterExecution('Error: ', 'Tables created.'));

function afterExecution(errorMessage, successMessage) {
    return function(err, result) {
        if (err) {
            return console.log(errorMessage + err);
        } else {
            return console.log(successMessage);
        }
    }
}

function afterExecutionBis(errorMessage, successMessage) {
    return function(err, result) {
        booleanContinue++;
        if (err) {
          return console.log(errorMessage + err);
        } else {
          return console.log(successMessage);
        }
        if(booleanContinue >= 15900 && once == false){
          once = true;
          insertTweet();
        }
    }
}
function insertTweet()
{
  var upsertTweet = 'INSERT INTO twitter.Tweets (tweetid, author, created_at, body) '
      + 'VALUES(?, ?, ?, ?);';

  var t = byline(fs.createReadStream(__dirname + '/sample.json'));

  t.on('data', function(line) {
  try {
      var obj = JSON.parse(line);
      obj.tweetid = uuid.v1();
      obj.created_at = new Date(Date.parse(obj.created_at));
      client.execute(upsertTweet,
              [obj.tweetid, obj.username, obj.created_at, obj.text],
              afterExecution('Error: ', 'Tweet ' + obj.tweetid + ' upserted.'));

      //Gets the users following the user creating the tweet
      var getFollowers = "SELECT * FROM twitter.Users_src_dest WHERE src = ?";
      var followers = [];
      client.execute(getFollowers,
            [ obj.username ], function(e, result) {
        		if (result.rows.length>0) {//checks if a result has been received
              for (i =0; i<result.rows.length;i++)//scans through result and adds every element to "followers" list
              {
                var upsertTimeline = 'INSERT INTO twitter.Timeline (username, tweetid, author, created_at, body) '
                    + 'VALUES(?, ?, ?, ?, ?);';
                client.execute(upsertTimeline,
                      [result.rows[i].dest, obj.tweetid, obj.username, obj.created_at, obj.text],
                      afterExecution('Error: ', 'Timeline ' + followers[i] + ' ' +obj.tweetid + ' upserted.'));
              }
        		}
        	});

  } catch (err) {
      console.log("Error:", err);
  }
  });
  t.on('end', function(){
    console.log("Finish");
  });
}
