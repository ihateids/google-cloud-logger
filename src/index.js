'use strict'

const path = require('path');
const stackParser = require('stacktrace-parser');

const { AsyncLocalStorageContext: appNamespace } = require('@northscaler/continuation-local-storage');
const { Logging } = require('@google-cloud/logging');

const originalLogMethod = console.log;
const originalErrorMethod = console.error;
const originalWarnMethod = console.warn;
const originalDebugMethod = console.log; // somehow did not work with console.debug on cloud 

let defaultDirectoriesDepthInCallStack = 4;

// following be set in init method
let logging; 
let directoriesDepthInCallStack; 
let getExtraStackInfoCallback; 
let defaultLoggerMetadata;

//
//  setLogEntryMetadata - update  metadata stored at namespace level (metadata of current thread)
//

function setLogEntryMetadata(logEntryMetadata, prefix) {
    // in some cases metadata is not know in the moment when they are set
    if (logEntryMetadata) {
        let logEntryMetadataPrefixed = {}
        Object.keys(logEntryMetadata).forEach(key => {
            const prefixedKey = prefix ? prefix + '.' + key : key
            //only strings are supported. Also 'value == null' returns true also if values is undefined
            logEntryMetadataPrefixed[prefixedKey] = (logEntryMetadata[key] == null) ? undefined : logEntryMetadata[key] + "";
        })

        appNamespace().set("logEntryMetadata", {
            ...appNamespace().get("logEntryMetadata"),
            ...logEntryMetadataPrefixed
        });
    }
}
//
//  getLogEntryMetadata - apart of other, we need to provide nanoseconds for propert sorting of log entries in stack driver
//

function getLogEntryMetadata(logEntryMetadata, callStackInfo) {
    // in case log entry contains createdOn field, we'll use it as logEntry timestamp
    const createdOn = appNamespace().get("logEntryMetadata")?.createdOn;
    let metadata = { ...defaultLoggerMetadata, timestamp: createdOn ? createdOn : new Date()} // getCurrentISOtimestampWithNanoseconds() does not provide accurate time
    metadata.labels = { ...logEntryMetadata, ...callStackInfo }
    return metadata;
}
//
//  getLogEntry
//
// 

function getLogEntryPayload(args) {
    let payload = null;

    if (typeof (args[0]) === 'object') {
        // to make sure there is no object reference in the object
        args[0] = serializeObject(args[0]);
        if (typeof (args[1]) !== 'object') {
            const message = args[0].message ? args[1] + ' ' + args[0].message : args[1];
            payload = { ...args[0], message: message }
        }
        else {
            payload = { ...args[0] }
        }
    }
    else {
        if (args.length === 2) {
            if (typeof (args[1]) === 'object') {
                // to make sure there is no object reference in the object
                args[1] = serializeObject(args[1]);
                payload = { ...args[0] }
                //to make sure message is not overwritten when outputing to log
                const message = args[1].message ? args[0] + ' ' + args[1].message : args[0];
                payload = { ...args[1], message: message }
            }
            else {
                // args.join does not workk for this type (?)
                payload = args[0] + ' ' + args[1];
            }
        }
        else {
            payload = args[0];
        }
    }
    return payload;
}

//
// serializeObject() - by default return full payload, if error object, get stack (this is not written to log by default)
//

function serializeObject(payload) {
    try {
        if (payload instanceof Error) {
            return {
                stack: payload.stack ? payload.stack : null,
                error: payload.error ? payload.error : null,
                message: payload.error ? (payload.error.message ? payload.error.message : payloadtoString()) : payload.toString()
            }
        }
        else return payload;
    }
    catch (error) {
        originalLogMethod("serializeObject error:", error);
        return payload;
    }
}

//
//
//
function getCallsStackInfo() {
    const callStack = stackParser.parse(new Error().stack).slice(2, 4) // we do not want to get cloud logger function calls in the stack
    callStack.forEach(item => {
        const pathToMethodParsed = item.file.split(path.sep).slice(-1 * (directoriesDepthInCallStack)) // need only last four components of file path
        item.pathToMethodParsed = pathToMethodParsed
        item.pathToMethod = pathToMethodParsed.join(path.sep);
        item.country = pathToMethodParsed[1];
    }
    )
    // we'll return just single method that called log entry, not needed to dump fullstack to the log
    let result = {
        "callee.method": callStack[0].methodName,
        "callee.path": callStack[0].pathToMethod + ":" + callStack[0].lineNumber,
    }
    if (callStack[1]) {
        result = {
            ...result,
            "caller.method": callStack[1].methodName,
            "caller.path": callStack[1].pathToMethod + ":" + callStack[1].lineNumber,

        }
    }
    return {
        ...result, ...getExtraStackInfoCallback(callStack)
    }
}
function defaultGetExtraStackInfoCallback(stackEntry) {
    return {}
}
//
// enable - called at start ()
//

// Misko ma dnes 10 rokov, 10 mesiacov, 10 dni :-D !!!
function init(options) {

    directoriesDepthInCallStack = options.directoriesDepthInCallStack ?? defaultDirectoriesDepthInCallStack;
    getExtraStackInfoCallback = options.getExtraStackInfoCallback ?? defaultGetExtraStackInfoCallback; 
    defaultLoggerMetadata = options.defaultLoggerMetadata ?? defaultLoggerMetadata;
   
    const logName = options.logName ?? 'missing_log_name';
    const isRunningOnCloud = options.isRunningOnCloud ?? true;
   
    logging = new Logging({
        projectId: options.projectId,
    });
    const log = isRunningOnCloud ? logging.log(logName) : undefined;
   
    console.log = function () {
        try {
            if (isRunningOnCloud) {
                const callStackInfo = getCallsStackInfo();
                const metadata = getLogEntryMetadata(appNamespace().get("logEntryMetadata"), callStackInfo);
                const payload = getLogEntryPayload(arguments);
                const entry = log.entry({ ...metadata, severity: "INFO" }, payload);
                log.write(entry).catch(error => originalErrorMethod(getLogEntryPayload(["Overridden console.log", error])));
                // originalLogMethod(payload);
            }
            else {
                return originalLogMethod.apply(this, arguments);
            }
        }
        catch (error) {
            originalErrorMethod(getLogEntryPayload(["Overridden console.log", error]));
        }
    }

    console.error = function () {
        try {
            if (isRunningOnCloud) {
                const callStackInfo = getCallsStackInfo();
                const metadata = getLogEntryMetadata(appNamespace().get("logEntryMetadata"), callStackInfo);
                const payload = getLogEntryPayload(arguments);
                const entry = log.entry({ ...metadata, severity: "ERROR" }, payload);
                log.write(entry).catch(error => originalErrorMethod(getLogEntryPayload(["Overridden console.error", error])));
                // originalErrorMethod(payload);        
            }
            else {
                return originalErrorMethod.apply(this, arguments);
            }
        }
        catch (error) {
            originalErrorMethod(getLogEntryPayload(["Overridden console.error", error]));
        }
    }

    console.warn = function () {
        try {
            if (isRunningOnCloud) {
                const callStackInfo = getCallsStackInfo();
                const metadata = getLogEntryMetadata(appNamespace().get("logEntryMetadata"), callStackInfo);
                const payload = getLogEntryPayload(arguments);
                const entry = log.entry({ ...metadata, severity: "WARNING" }, payload);
                log.write(entry).catch(error => originalErrorMethod(getLogEntryPayload(["Overridden console.warn", error])));
                // originalWarnMethod(payload);
            }
            else {
                return originalWarnMethod.apply(this, arguments);
            }
        }
        catch (error) {
            originalErrorMethod(getLogEntryPayload(["Overridden console.warn", error]));
        }
    }

    console.debug = function () {
        try {
            if (isRunningOnCloud) {
                const callStackInfo = getCallsStackInfo();
                const metadata = getLogEntryMetadata(appNamespace().get("logEntryMetadata"), callStackInfo);
                const payload = getLogEntryPayload(arguments);
                const entry = log.entry({ ...metadata, severity: "DEBUG" }, payload);
                log.write(entry).catch(error => originalErrorMethod(getLogEntryPayload(["Overridden console.debug", error])));
                // originalDebugMethod(payload);
            }
            else {
                return originalDebugMethod.apply(this, arguments);
            }
        }
        catch (error) {
            originalErrorMethod(getLogEntryPayload(["Overridden console.debug", error]));
        }
    }

}

module.exports = {
    init,
    setLogEntryMetadata
}
