module.exports=function(config){
  config.set({frameworks:['jasmine'],plugins:[require('karma-jasmine'),require('karma-chrome-launcher')],
    reporters:['progress'],port:9876,colors:false,logLevel:config.LOG_INFO,
    browsers:['ChromeHeadlessNoSandbox'],customLaunchers:{ChromeHeadlessNoSandbox:{base:'ChromeHeadless',flags:['--no-sandbox']}},
    singleRun:true,restartOnFileChange:false,browserNoActivityTimeout:120000});
};
