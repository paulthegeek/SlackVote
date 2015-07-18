'use strict';

/*
 * Express Dependencies
 */
var express = require('express');
var exphbs  = require('express3-handlebars');
var nconf = require('nconf');
nconf.argv()
       .env()
       .file({ file: './config.json' });
var app = express();
var port = 3000;

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

/*
 * Mongo DB
 */
var mongo = require('mongodb');
var monk = require('monk');
var mongoUri = process.env.MONGOLAB_URI ||
  process.env.MONGOHQ_URL ||
  'localhost:27017/VoteDB';

var db = monk(mongoUri);

/*
 * Slack configuration
 */
var Slack = require('slack-node');
var appAccessToken = nconf.get(process.env.ACCESSTOKEN);

// For gzip compression
app.use(express.compress());


// Make our db accessible to our router
app.use(function(req,res,next){
    req.db = db;
    next();
});

// Configure app
app.configure(function(){
  app.use(express.bodyParser());
  app.use(app.router);
});


/*
 * Routes
 */
// Index Page
app.get('/', function(request, response, next) {
    response.render('index');
});

// Outgoing webhooks from Slack
app.post('/outgoing', function(req, res, next) {
    var votes = req.db.get('votes');

    if (req.body.token != nconf.get(process.env.OUTGOINGTOKEN)) {
        res.json({ text : 'Invalid token' });
        return;
    }

    var trigger_word = req.body.trigger_word;
    var trigger_text = req.body.text;

    // config for slack api call
    var slack = new Slack(appAccessToken);
    var channelID = req.body.channel_id;

    // Trigger is to start vote
    if (trigger_word == 'startvote') {

        //get all members in channel
        slack.api("channels.info", { 'channel' : channelID}, function(err, response) {

            //expect their responses
            response.channel.members.forEach(function(m) {
                votes.update(
                    { 'userID' : m, 'channelID' : channelID },
                    { 'userID' : m, 'username': '', 'channelID' : channelID, 'status' : 0, 'vote': ''},
                    { upsert: true },
                    function (err, doc) {
                        if (err) throw err;
                        console.log(doc);
                    }
                );
            });

        });

        //respond asking for votes from everyone
        res.json({text: 'everyone reply with "/vote <youranswer>"'});

    } else if (trigger_word == 'reveal') {

        var returnText = 'Votes:\n';

        // get channel members
        slack.api('channels.info', { 'channel' : channelID }, function(err, response) {

            var params = { userID : { $in : response.channel.members }, channelID : channelID, status : 1 };

            votes.find(
                params,
                function(err, results){
                    if (err) throw err;

                    if (results.length > 0) {
                        results.forEach(function(r) {
                            if (trigger_text.indexOf('anon') < 0) {
                                returnText += r.username + " votes ";
                            }
                            returnText += r.vote + "\n";
                        });
                        res.json({ text: returnText });
                    } else {
                        res.json({ text : "No votes found." });
                    }
                }
            );
        });
    } else if (trigger_word == 'votecount') {
        // get channel members
        slack.api('channels.info', { 'channel' : channelID }, function(err, response) {

            var params = { userID : { $in : response.channel.members }, channelID : channelID, status : 1 };

            votes.find(
                params,
                function(err, results){
                    if (err) throw err;

                    res.json({ text : results.length + " votes casted" });
                }
            );
        });
    } else {
        res.json({ text : 'Unknown trigger' });
    }

});

// Slack command - vote from a user
app.post('/vote', function(req, res, next) {

    var votes = req.db.get('votes');
    var input = req.body;
    console.log(input);

    if (input.token != nconf.get(process.env.COMMAND)) {
        res.json('Invalid token');
        return;
    }
    votes.update(
        { userID : input.user_id, channelID : input.channel_id },
        { $set: { status : 1, vote : input.text, username : input.user_name }},
        function(err, doc) {
            console.log(err);
            console.log(doc);
            if (err) {
                res.json('Something went wrong. Your vote was not recorded.');
            } else {
                res.json('Your vote \'' + input.text + '\' has been recorded.');
            }
        }
    );
});


/*
 * Start it up
 */
app.listen(process.env.PORT || port);
console.log('Express started on port ' + port);
