# WORK IN PROGRESS ...

## How it works

The package overrides default handling of console log/debug/warn and error. If object is provided as argument, it will put the object in jsonPayload of log entry instead of dumping the object on multiple lines.

It is also possible to provide additional labels (e.g. sessionId, executionId, endPoint,git info, etc). Just add following somewhere into your main express/axios script

```javascript
import { AsyncLocalStorageContext: appNamespace } from '@northscaler/continuation-local-storage'; // prerequisite:  Node.js >= 12.17.0

appNamespace().run(() => {
    appNamespace().set("logEntryMetadata", {
        executionId: uuidv4(),
        endPoint: endpointName,
        "git.branch": GIT_BRANCH,
        "git.commit": GIT_COMMIT
     });
    endpointFunction(req, res)
})

```
you can update labels for any subsequent log entries by using

```javascript
cloudLogger.setLogEntryMetadata({consumerId:12345}, '');
```

## How to install

npm i google-cloud-logger 

## Important Note

If the AppEngine project is different to project where you want to log, make sure the AppEngine service account has IAM logs write access to target project. Also, Cloud Functions are using by default the same service account as AppEngine.

## Example of How to use

Example below is using google AppEngine environment variable GAE_INSTANCE. If the variable is set, it means the solution runs on google cloud and every logging into console will use the google-cloud-logger. If not set, then standard logging is used (e.g. when running locally)

Every log entry will also include AppEngine module, version and instance id.

```javascript
import cloudLogger from "google-cloud-logger";

const {
    GAE_SERVICE,
    GAE_VERSION,
    GAE_INSTANCE
} = process.env

const CLOUD_LOGGER_PROJECT_ID = 'solaris-qa-consumer';
const CLOUD_LOGGER_DEFAULT_LOG_NAME = 'google-cloud-test';
const CLOUD_LOGGER_RESOURCE_TYPE = 'gae_app';
const IS_RUNNING_ON_CLOUD = GAE_INSTANCE ? true : false;


const options = {
    isRunningOnCloud: IS_RUNNING_ON_CLOUD,
    projectId: CLOUD_LOGGER_PROJECT_ID,
    logName: CLOUD_LOGGER_DEFAULT_LOG_NAME,
    defaultLoggerMetadata: {
        resource: {
            type: CLOUD_LOGGER_RESOURCE_TYPE,
            labels: {
                module_id: GAE_SERVICE,
                version_id: GAE_VERSION,
                instance_id: GAE_INSTANCE
            }
        },
        labels: {}
    }
}

cloudLogger.init(options);

console.log("This is logging of simple text");
console.log(options); //This is logging of object
console.debug("This is logging of text and object:", options);
console.warn("This is a warning");
console.error("This is an error:", new Error());
```

## How it looks in google StackDriver log

![StackDriver log](./assets/img1.png "")
![StackDriver log](./assets/img2.png "")









