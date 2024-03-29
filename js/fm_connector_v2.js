(function() {
  var fmConnector = tableau.makeConnector();

  fmConnector.init = function(callback) {
    // If there is connectionData present in the interactive phase or Authentication phase, repopulate the input text box.
    // This is hit when re-login or editing a connection in Tableau.
    if (tableau.phase === tableau.phaseEnum.interactivePhase || tableau.phase === tableau.phaseEnum.authPhase ) {
      if(tableau.connectionData){

        var conf  = JSON.parse(tableau.connectionData);
        $('#solutionName').val(conf.solution);
        $('#layoutName').val(conf.layout);
        $('#pageSize').val(parseInt(conf.pageSize) || 1000); //default value : 1000 records
        $('#user').val(tableau.username);
        $('#incremental').attr('checked', conf.incremental);
        $("#submitButton").prop('disabled', false);
      }
      $('#solutionName').focus();
    }
    //After Tableau close, tableau.password will be removed. Tableau is in data-gathering phase when it re-open and
    //it should call the connector in auth phase, which will display the UI that lets the user sign in again.
    if (tableau.phase === tableau.phaseEnum.authPhase) {
      //disable all input fields except username and password for re-login purpose.
      $(".inputBoxTitle h3").text(lang.Title_Login_Again)
      $('#solutionName').prop('disabled', true);
      $('#layoutName').prop('disabled', true);
      $('#pageSize').prop('disabled', true);
      $('#incremental').prop('disabled', true);
      $('#user').focus();
    }

    // set tableau.alwaysShowAuthUI to true. This will make Tableau to display custom re-login UI when is re-open.
    tableau.alwaysShowAuthUI = true;

    //tableau.initCallback();
    callback()
  };

  fmConnector.getSchema = function(schemaCallback) {
    var conf  = JSON.parse(tableau.connectionData);

    var layouts =  conf.layout.split(',');
    // Schema for magnitude and place data
    var schemas = []
    layouts.forEach(function(layout){
      var columns = fmConnector.getMetaData(layout)
      schemas.push({
        id: layout,
        alias: layout,
        columns: columns,
        incrementColumnId: "_recordId"
      })
    });

    schemaCallback(schemas);
  };


  // With this sample we will generate some sample date for the columns: id, x, day, date_and _time, true_or_false, and color.
  // The user input for the max iterations determines the number of rows to add.
  fmConnector.getData = function(table, doneCallback) {
    var conf  = JSON.parse(tableau.connectionData);
    //var passwordObj = fmConnector.getPasswordObj();
    var lastRecordId = parseInt(table.incrementValue || -1);
    var layout = table.tableInfo.id

    if (conf.passwordObj.tokens[layout] === undefined) {
      return tableau.abortWithError(lang.Error_Missing_Session_Token);
    }


    var lastRecordToken = conf.passwordObj.cursors[layout] || ''

    //Full update request
    if (lastRecordId === -1){
      lastRecordId = '';
      fmConnector.resetDataCursor(layout, lastRecordId);

    } else if (!isNaN(lastRecordToken)){
      //Get here from the first loop of this function,
      //The lastRecordToken is pass in form Tableau _startRequestTableData which use _lastRefreshColVal for lastRecordToken
      lastRecordId = parseInt(table.incrementValue);
      //reset cursor at the first loop for incremental refresh.
      fmConnector.resetDataCursor(layout, lastRecordId);
    } else {
      //Get here from the tableau.dataCallback loop
      //We intentionally pass an object contains lastRecordId via tableau.dataCallback to make it look different at the first loop.
      //var lastRecordTokenObj = JSON.parse(lastRecordToken);
      lastRecordId = parseInt(table.incrementValue);
    }

    conf  = JSON.parse(tableau.connectionData);
    var lastRecordToken = conf.passwordObj.cursors[layout] || ''

    // to call fetch data api
    var pageSize = parseInt(conf.pageSize || 1000); //500 5000
    var connectionUrl = conf.apiPath + "databases/"+encodeURIComponent(conf.solution) + "/layouts/" + encodeURIComponent(layout) + "/cursor?_limit="+pageSize;
    var hasMoreRecords = true;
    while (hasMoreRecords)  {
      var xhr = $.ajax({
        url: connectionUrl,
        dataType: 'json',
        async:false,
        contentType: "application/json",
        headers: {"Authorization": "Bearer " + conf.passwordObj.tokens[layout], "X-FM-Data-Cursor-Token":lastRecordToken },
        success: function (res, textStatus, xhr)  {
          if (res.messages && res.messages[0].code === '0') {
            if(res.response.data.length>0){
              var toRet = [];
              res.response.data.forEach(function(record){
                if(table.tableInfo.incrementColumnId){
                  //recordId must be in filedData for incremental extraction
                  record.fieldData[table.tableInfo.incrementColumnId] = parseInt(record.recordId);
                }
                toRet.push(util.dataToLocal(record.fieldData, table.tableInfo.columns));
                lastRecordId = record.recordId;

              })
              hasMoreRecords = toRet.length < pageSize ? false : true;
              table.appendRows(toRet)
              //We intentionally pass an object contains lastRecordId via tableau.dataCallback to make it look different at the first loop.
              //tableau.dataCallback(toRet, JSON.stringify({lastRecordId:lastRecordId}), hasMoreRecords);
            } else {
              hasMoreRecords = false;
              if(lastRecordId == 0){
                return tableau.abortWithError(lang.Error_No_Results_Found);
              }
            }

          } else {
            hasMoreRecords = false;
            tableau.abortWithError(lang.Error_Failed_To_Fetch_Data + " : " + xhr.responseText);
          }
        },
        error: function (xhr, textStatus, thrownError) {
          if(xhr.readyState===4 && xhr.responseText.indexOf("952")>-1){//handle Invalid token
            //If FM session expired during Tableau extracting data, we can relogin FM and pickup from lastRecordId.
            fmConnector.FMConnectLayout(table.tableInfo.id, table, doneCallback);
          }
          else{
            hasMoreRecords = false;
            tableau.abortWithError(lang.Error_Failed_To_Fetch_Data + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
          }
        }
      });
      }
    doneCallback()
  };

  //store field names, types and other resource metaData into tableau.connectionData
  fmConnector.parseMetaData = function(metaData){
    var dataTypesMap = {"text":"string", "bool":"bool", "date":"date", "time":"string", "timestamp":"datetime", "number":"float", "int":"int"};
    var connectionConf  = JSON.parse(tableau.connectionData);

    var fields = []
    metaData.forEach(function(meta){
      if(fields.indexOf(meta.name.replace(/::/, '__')) == -1){ //skip duplicated field if it is already included
        fields.push({id:meta.name.replace(/::/, '__'), dataType:dataTypesMap[meta.result]})
      }
    })

    if(connectionConf.incremental){
      fields.push({id:'_recordId', dataType:'int'})
      //-recordId must be included for incremental extraction.
    }

    return fields;
  };

  fmConnector.getMetaData = function(layout){
    var connectionConf  = JSON.parse(tableau.connectionData);
    var connectionUrl = connectionConf.apiPath + "databases/"+encodeURIComponent(connectionConf.solution) +"/layouts/"+encodeURIComponent(layout)+"/metadata";
    //var passwordObj = fmConnector.getPasswordObj();

    var result = null
    var xhr = $.ajax({
      url: connectionUrl,
      type:"GET",
      headers: {"Authorization": "Bearer " + connectionConf.passwordObj.tokens[layout]},
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          if(res.response.metaData.length==0){
            throw new Error(lang.Error_Get_Meta_Data_Failed +": "+ xhr.responseText);
          }else{
            result = fmConnector.parseMetaData(res.response.metaData);
          }
        } else {
          throw new Error(lang.Error_Get_Meta_Data_Failed +": "+ xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        throw new Error(lang.Error_Get_Meta_Data_Failed + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
      },
      async: false
    });
    return result
  }

  fmConnector.createDataCursor = function(layout) {
    ///lastRecordToken is a string so it need to converted to number to match recordId data type.
    var conf  = JSON.parse(tableau.connectionData);
    //var passwordObj = fmConnector.getPasswordObj();

    // calling createCursor api
    var connectionUrl = conf.apiPath +"databases/" + encodeURIComponent(conf.solution) +"/layouts/" + encodeURIComponent(layout) + "/cursor";
    console.log("CREATE CURSOR TOKEN FOR ", layout);
    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: {"Authorization": "Bearer " + conf.passwordObj.tokens[layout]},
      type:"POST",
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          conf.passwordObj.cursors[layout] = res.response.cursorToken;
          tableau.connectionData = JSON.stringify(conf);
        } else {
          throw new Error(lang.Error_Create_Cursor_Failed+": " + xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        throw new Error(lang.Error_Create_Cursor_Failed+ " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
      },
      async: false
    });
  };

  // Reset Cursor for incremantal extraction
  fmConnector.resetDataCursor = function(layout, lastRecordId) {
    var conf  = JSON.parse(tableau.connectionData);
    //var passwordObj = fmConnector.getPasswordObj();

    // calling createCursor api
    var connectionUrl = conf.apiPath +"databases/" + encodeURIComponent(conf.solution) +"/layouts/" + encodeURIComponent(layout) + "/cursor/reset";
    //console.log("RESET CUSRSOR ");

    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: {"Authorization": "Bearer " + conf.passwordObj.tokens[layout], "X-FM-Data-Cursor-Token": conf.passwordObj.cursors[layout] },
      type:"POST",
      data: lastRecordId===0 ? "" : JSON.stringify({recordId:lastRecordId.toString()}),
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code !== '0') {
          tableau.abortWithError(lang.Error_Reset_Cursor +' :'+ xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        if(xhr.readyState===4 && xhr.responseText.indexOf("952")>-1){ //handle Invalid token
          //Skip re-login which will be called in getTableData step.
        }
        else{
          tableau.abortWithError(lang.Error_Reset_Cursor + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
        }
      },
      async: false
    });
  };

  fmConnector.shutdown = function(shutdownCallback) {
    //In case of re-login cuased by expried token durign gatehrData phase,
    //new token can't be updated into tableau.password and won't be reusable when this connector was reloaded.
    //We have to enforce logout for each shutdown after re-login to avoid creating idel FM session.
    if(tableau.phase === tableau.phaseEnum.gatherDataPhase && fmConnector.reLogin) {
      //var passwordObj = fmConnector.getPasswordObj();
      var connectionConf = JSON.parse(tableau.connectionData);
      var connectionUrl = connectionConf.apiPath + "databases/" + encodeURIComponent(connectionConf.solution) + "/sessions";
      var layouts = connectionConf.layout.split(',')

      layouts.forEach(function (layout) {
        var xhr = $.ajax({
          url: connectionUrl,
          type: "DELETE",
          headers: {"Authorization": "Bearer " + connectionConf.passwordObj.tokens[layout]},
          async: false,
          success: function (res, textStatus, xhr) {
            tableau.shutdownCallback();
          },
          error: function (xhr, textStatus, thrownError) {
            tableau.abortWithError(lang.Error_Logout_Failed + " : " + util.makeErrorMessage(xhr, textStatus, thrownError));
          }
        })
      })
    }
    shutdownCallback();
  }

  /* helper functions */
  /* fmConnector.getPasswordObj = function(){
    if(!tableau.password){
      return tableau.abortWithError(lang.Error_Missing_Password_Object );
    }
    var passwordObj = JSON.parse(tableau.password);
    if(tableau.phase === tableau.phaseEnum.gatherDataPhase){
      if(!passwordObj.token){
        return tableau.abortWithError(lang.Error_Missing_Session_Token  );
      }
      if(!passwordObj.cursors){
        return tableau.abortWithError(lang.Error_Missing_Cursor_Token );
      }
    }
    return passwordObj;
  } */

  fmConnector.FMLogin = function() {
    var connectionConf  = JSON.parse(tableau.connectionData);
    var layouts = connectionConf.layout.split(',')

    /*var
    passwordObj = fmConnector.getPasswordObj();

    //Reset token/cursors
    passwordObj.cursors = {}
    passwordObj.token = {}
    tableau.password = JSON.stringify(passwordObj);
    */
    //Reset cursors & tokens
    connectionConf.passwordObj = { tokens: {}, cursors: {} }
    tableau.connectionData = JSON.stringify(connectionConf);


    layouts.forEach(function (layout) {
        fmConnector.FMConnectLayout(layout)
    })
    $('#loader').hide();
    tableau.submit();
  }

  //The optional string parameter lastRecordToken indicates that the wip session expired during Tableau extracting data.
  fmConnector.FMConnectLayout = function(layout, table, doneCallback) {
    var connectionConf  = JSON.parse(tableau.connectionData);
    var connectionUrl = connectionConf.apiPath + "databases/"+encodeURIComponent(connectionConf.solution)+"/sessions";

    var layout = layout || table.tableInfo.id
    if(connectionConf.loginType === "oauth"){
      var headers = {
        "X-FM-Data-OAuth-Request-Id":connectionConf.passwordObj.oAuthRequestId,
        "X-FM-Data-OAuth-Identifier":connectionConf.passwordObj.oAuthIdentifier
      };

    }else{//Regular login with FM account
      var headers = {
        "Authorization": "Basic " + window.btoa(tableau.username + ':' + tableau.password) // will window.btoa actually work??
      };
    }
    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: headers,
      type:"POST",
      data: {},
      async: false,
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          try {
            connectionConf.passwordObj.tokens[layout] = xhr.getResponseHeader('x-fm-data-access-token');
            tableau.connectionData = JSON.stringify(connectionConf);
            if (tableau.phase === tableau.phaseEnum.gatherDataPhase) {
              //Re-login during a Tableau session, skip setup metadata and getTableData directly
              fmConnector.reLogin = true;
              fmConnector.getData(table, doneCallback);
            } else {
              //console.log('create cursors')
                fmConnector.createDataCursor(layout);
                fmConnector.getMetaData(layout);
            }
          }catch(err){
            return tableau.abortWithError(err.message);
          }
        } else {
          return tableau.abortWithError(lang.Error_Login_Failed +": " + xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        return  tableau.abortWithError(lang.Error_Login_Failed + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
      }
    });
  }

  fmConnector.Oauth = {

    providers : [],  //contains oauth providers meta data which will be populated with getProvidersInfo()

    getProvidersInfo : function(){
      var xhr = $.ajax({
        context: this,
        dataType:'json',
        url: location.origin+'/fmws/oauthproviderinfo',
        success: function (res, textStatus, xhr)  {
          if(res.data){
            this.providers = res.data.Provider;
            this.providers.sort(function SortByName(a, b){//sort on provider name to make them rendered in consistent order.
              var aName = a.Name.toLowerCase();
              var bName = b.Name.toLowerCase();
              return ((aName < bName) ? -1 : ((aName > bName) ? 1 : 0));
            });
            this.renderBtns();
          }
        },
        error: function (xhr, textStatus, thrownError) {
          tableau.abortWithError(lang.Error_OAuth_Fail_At_GetProvidersInfo+ util.makeErrorMessage(xhr, textStatus, thrownError));
        }
      })
    },

    renderBtns : function(){
      var providersList = $('#oauth-container');

      if(this.providers.length>0){
        this.providers.forEach(function(provider){
          var $btn = $("<button>", {"data-provider-name":provider.Name, "class": "oauth-btn", "text": provider.Name});
          $btn.click(fmConnector.Oauth.doOauth);
          providersList.append($btn);
        })

        util.getCookie("oAuthIdentifier") ? providersList.show() : providersList.slideDown();
      }
    },

    doOauth: function(e){
      var connectionConf = {};
      connectionConf.loginType = "oauth";
      connectionConf.apiPath = location.origin;
      connectionConf.apiPath = connectionConf.apiPath + '/fmi/data/vLatest/';
      connectionConf.solution = $('#solutionName').val().trim();
      connectionConf.layout = $('#layoutName').val().trim();
      connectionConf.incremental = $('#incremental').is(':checked');
      connectionConf.passwordObj = { tokens: {}, cursors: {} }
      tableau.connectionData = JSON.stringify(connectionConf);
      tableau.username = "";

      if(util.validateInput()===true){
        fmConnector.Oauth.getOauthUrl($(this).data("provider-name"));
      }
      return false;
    },

    getOauthUrl: function(provider){
      $('#loader').show();
      var apiUrl = '/oauth/getoauthurl?trackingID=&provider='+provider+'&address='+location.hostname+'&X-FMS-OAuth-AuthType=2';
      var headers = {
        "X-FMS-Application-Type" : 9,
        "X-FMS-Application-Version" : 15,
        "X-FMS-Return-URL" : location.href
      }

      var xhr = $.ajax({
        context: this,
        url: location.origin+apiUrl,
        dataType:"text",
        headers: headers,
        success: function (data, textStatus, xhr)  {
          $('#loader').hide();
          var oAuthRequestId = xhr.getResponseHeader('X-FMS-Request-ID');
          var oAuthUrl = data.trim();
          if(!oAuthUrl) {
            return tableau.abortWithError(lang.Error_OAuth_Fail_At_GetOauthUrl + lang.Error_OAuth_Empty_Url);
          }
          var d = new Date();
          d.setTime(d.getTime() + (3*60*1000));
          document.cookie = "oAuthRequestId="+oAuthRequestId+"; expires="+d.toUTCString();
          location.href = oAuthUrl;
        },
        error: function (xhr, textStatus, thrownError) {
          $('#loader').hide();
          tableau.abortWithError(lang.Error_OAuth_Fail_At_GetOauthUrl + util.makeErrorMessage(xhr, textStatus, thrownError))
        }
      })

    }
  };

  tableau.registerConnector(fmConnector);

  //
  // Setup connector UI
  //

  $(window).load(function() {
    if(tableau.phase === tableau.phaseEnum.gatherDataPhase ){
      return;
    }

    util.applyI18nString();

    var query = util.queryString();
    if(query.identifier){
      if(!tableau.connectionData){ // If user clicking on link of FMS oauth redirect in broswer history, force it back to connector page.
        return location.replace(location.origin+location.pathname);
      }
      var d = new Date();
      d.setTime(d.getTime() + (30*1000));
      document.cookie = "oAuthIdentifier="+query.identifier+"; expires="+d.toUTCString();
      return location.replace(location.origin+location.pathname);
    }else if(util.getCookie("oAuthIdentifier") && util.getCookie("oAuthRequestId")){  // this is redirected after putting identifier in cookie
      fmConnector.Oauth.getProvidersInfo();
      tableau.password = JSON.stringify({oAuthRequestId: util.getCookie("oAuthRequestId"), oAuthIdentifier: util.getCookie("oAuthIdentifier"), token:''});
      util.removeCookie("oAuthIdentifier");
      util.removeCookie("oAuthRequestId");
      var connectionConf  = JSON.parse(tableau.connectionData);
      $('#solutionName').val(connectionConf.solution);
      $('#layoutName').val(connectionConf.layout);
      $('#pageSize').val(connectionConf.pageSize);
      $('#incremental').attr('checked', connectionConf.incremental);
      $("#submitButton").prop('disabled', false);
      $('#loader').show();
      fmConnector.FMLogin();
    }else {
      fmConnector.Oauth.getProvidersInfo();
    }

    if(!tableau.connectionData){
      //Initial page load should not have saved connection data and submitButton should be disabled.
      //If page are reloaded after login failure, submitButton should be enabled by init().
      $("#submitButton").prop('disabled', true);
    }
    $('#solutionName').on('input', util.enableBtnOnInput);
    $('#layoutName').on('input', util.enableBtnOnInput);
    $("#submitButton").click(function() {
      var connectionConf = {};
      connectionConf.loginType = "";
      connectionConf.apiPath = location.origin;
      connectionConf.apiPath = connectionConf.apiPath + '/fmi/data/vLatest/';
      connectionConf.solution = $('#solutionName').val().trim();
      connectionConf.layout = $('#layoutName').val().trim();
      connectionConf.pageSize = $('#pageSize').val().trim();
      connectionConf.incremental = $('#incremental').is(':checked');
      connectionConf.passwordObj = { tokens: {}, cursors: {} }

      tableau.connectionData = JSON.stringify(connectionConf);
      tableau.username = $('#fm-user').val().trim();
      tableau.password = $('#fm-password').val().trim()
      //tableau.password = JSON.stringify({password: $('#password').val().trim(), token:''});

      if(tableau.phase === tableau.phaseEnum.interactivePhase || tableau.phase === tableau.phaseEnum.authPhase ){
        if(util.validateInput()){
          $('#loader').toggle(0);
          fmConnector.FMLogin();
        }
      }
    });
    //$("body").append(navigator.userAgent);
  });
})();