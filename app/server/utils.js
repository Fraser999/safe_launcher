import jwt from 'jsonwebtoken';
import mime from 'mime';
import sessionManager from './session_manager';
import { errorCodeLookup } from './error_code_lookup';
import { log } from './../logger/log';
import { MSG_CONSTANTS } from './message_constants';

export var getSessionIdFromRequest = function(req) {
  let authHeader = req.get('Authorization');
  if (!authHeader) {
    return;
  }
  if (authHeader.indexOf(' ') !== 6) {
    return;
  }
  authHeader = authHeader.split(' ');
  if (!(authHeader.length === 2 && authHeader[0].toLowerCase() === 'bearer')) {
    return;
  }
  let token = authHeader[1];
  let jwtSections = token.split('.');
  if (jwtSections.length !== 3) {
    return;
  }
  try {
    let payload = JSON.parse(new Buffer(jwtSections[1], 'base64').toString());
    let sessionInfo = sessionManager.get(payload.id);
    if (!sessionInfo) {
      return;
    }
    jwt.verify(token, new Buffer(sessionInfo.signingKey));
    return payload.id;
  } catch (e) {
    return;
  }
};

export class ResponseError {
  constructor(status, message) {
    message = message || MSG_CONSTANTS.ERROR_CODE[status];
    if (typeof message === 'object' && message.hasOwnProperty('errorCode')) {
      message.description = errorCodeLookup(message.errorCode);
      if (message.description.toLowerCase().indexOf('notfound') > -1 ||
          message.description.toLowerCase().indexOf('pathnotfound') > -1) {
        status = 404;
      }
    } else {
      message = {
        errorCode: 400,
        description: message
      };
    }
    this['errStatus'] = status;
    this['msg'] = message;
  }

  get status() {
    return this['errStatus'];
  };
  get message() {
    return this['msg'];
  };
}

export let ResponseHandler = function (req, res) {

  this.onResponse = function(err, data) {
    if (err) {
      return req.next(new ResponseError(400, err));
    }
    let successStatus = 200;
    if (data) {
      res.status(successStatus).send(formatResponse(data));
    } else {
      res.sendStatus(successStatus);
    }
  };

  return this.onResponse;
};

export var setSessionHeaderAndParseBody = function(req, res, next) {
  if (!req.get('Authorization')) {
    log.debug('Unauthorised request ::' + req.path);
    return next();
  }
  log.debug('Authorised request ::' + req.path);
  let sessionId = getSessionIdFromRequest(req);
  log.debug('Decrypted session id :: ' + sessionId);
  if (!sessionId) {
    log.warn('Session ID not found');
    return res.sendStatus(401);
  }
  req.headers['sessionId'] = sessionId;
  if (req.body && req.body.length > 0) {
    req.body = ((req.body instanceof Buffer) ? JSON.parse(req.body.toString()) : req.body);
    if (typeof req.body !== 'object') {
      return res.status(400).send('Invalid request body');
    }
  }
  next();
};

export var formatResponse = function(data) {
  if (typeof data === 'string') {
    data = JSON.parse(data);
  }

  let format = function(data) {
    var type = typeof data;
    switch (type) {
      case 'object':
        return (data.constructor === Array) ? formatList(data) : formatObject(data);
      default:
        return data;
    }
  };

  let convertToCamelCase = function(key) {
    if (!key || key.indexOf('_') === -1) {
      return key;
    }
    let temp;
    let keys = key.split('_');
    let newKey = '';
    for (let i in keys) {
      if (i === '0') {
        newKey = keys[i];
        continue;
      }
      temp = keys[i];
      newKey += (temp.substr(0, 1).toUpperCase() + temp.substr(1));
    }
    return newKey;
  };

  let formatObject = function(obj) {
    let computeTime = function(seconds, nanoSeconds) {
      return (seconds * 1000) + Math.floor(nanoSeconds / 1000000);
    };
    if (obj.hasOwnProperty('creation_time_sec')) {
      obj.createdOn = computeTime(obj.creation_time_sec, obj.creation_time_nsec);
      delete obj.creation_time_sec;
      delete obj.creation_time_nsec;
    }
    if (obj.hasOwnProperty('modification_time_sec')) {
      obj.modifiedOn = computeTime(obj.modification_time_sec, obj.modification_time_nsec);
      delete obj.modification_time_sec;
      delete obj.modification_time_nsec;
    }
    if (obj.hasOwnProperty('user_metadata')) {
      obj.metadata = obj.user_metadata;
      delete obj.user_metadata;
    }
    if (obj.hasOwnProperty('metadata') && typeof obj.metadata === 'string' && obj.metadata) {
      obj.metadata = (obj.metadata && obj.metadata[0] === '{') ? JSON.parse(obj.metadata) : obj.metadata;
    }
    var formattedObj = {};
    for (let key in obj) {
      formattedObj[convertToCamelCase(key)] = format(obj[key]);
    }
    return formattedObj;
  };

  let formatList = function(list) {
    var formattedList = [];
    for (let i in list) {
      formattedList.push(format(list[i]));
    }
    return formattedList;
  };

  return format(data);
};

export let sendResponseData = function(res, data, status) {
  let successStatus = status || 200;
  if (data) {
    res.status(successStatus).send(formatResponse(data));
  } else {
    res.sendStatus(successStatus);
  }
};