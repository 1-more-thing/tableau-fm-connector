(function() {
  var fmConnector = tableau.makeConnector();

  fmConnector.init = function() {
    // If there is connectionData present in the interactive phase or Authentication phase, repopulate the input text box.
    // This is hit when re-login or editing a connection in Tableau.
    if (tableau.phase === tableau.phaseEnum.interactivePhase || tableau.phase === tableau.phaseEnum.authPhase ) {
      if(tableau.connectionData){
        //default value
        $('#pageSize').val(1000);

        var conf  = JSON.parse(tableau.connectionData);
        $('#solutionName').val(conf.solution);
        $('#layoutName').val(conf.layout);
        $('#pageSize').val(conf.pageSize);
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
      $('#incremental').prop('disabled', true);
      $('#user').focus();
    }

    // set tableau.alwaysShowAuthUI to true. This will make Tableau to display custom re-login UI when is re-open.
    tableau.alwaysShowAuthUI = true;

    tableau.initCallback();
  };

  fmConnector.getSchema = function(schemaCallback) {

    var layouts = fmConnector.connectionData.layout.split(',');
    // Schema for magnitude and place data
    var schemas = []
    layouts.forEach(function(layout){
      result.push({
        id: layout,
        alias: layout,
        columns: fmConnector.getMetaData(layout),
        incrementColumnId: "-recordid"
      })
    });

    schemaCallback(schemas);
  };


  // With this sample we will generate some sample date for the columns: id, x, day, date_and _time, true_or_false, and color.
  // The user input for the max iterations determines the number of rows to add.
  fmConnector.getData = function(table, doneCallback) {
    var conf  = JSON.parse(tableau.connectionData);
    var passwordObj = fmConnector.getPasswordObj();
    var lastRecordToken = passwordObj.cursors['layout']
    var lastRecordId = 0
    var layout = table.tableInfo.id
    //lastRecordToken is a string, either empty string or recordToken, so it need to converted to number to match recordId data type.
    if (lastRecordToken.length === 0){
      lastRecordId = 0;
      fmConnector.resetDataCursor(lastRecordId);
    } else if (!isNaN(lastRecordToken)){
      //Get here from the first loop of this function,
      //The lastRecordToken is pass in form Tableau _startRequestTableData which use _lastRefreshColVal for lastRecordToken
      lastRecordId = parseInt(lastRecordToken);
      //reset cursor at the first loop for incremental refresh.
      fmConnector.resetDataCursor(lastRecordId);
    } else {
      //Get here from the tableau.dataCallback loop
      //We intentionally pass an object contains lastRecordId via tableau.dataCallback to make it look different at the first loop.
      var lastRecordTokenObj = JSON.parse(lastRecordToken);
      lastRecordId = parseInt(lastRecordTokenObj.lastRecordId);
    }

    // to call fetch data api
    var pageSize = parseInt(conf.pageSize || 1000); //500 5000
    var connectionUrl = conf.apiPath + "databases/"+encodeURIComponent(conf.solution) + "/layouts/" + encodeURIComponent(layout) + "/cursor?_limit="+pageSize;
    var hasMoreRecords = false;
    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: {"Authorization": "Bearer " + passwordObj.token, "X-FM-Data-Cursor-Token":passwordObj.cursorToken },
      success: function (res, textStatus, xhr)  {
        if (res.messages && res.messages[0].code === '0') {
          if(res.response.data.length>0){
            var toRet = [];
            res.response.data.forEach(function(record){
              if(tableau.incrementalExtractColumn){
                //recordId must be in filedData for incremental extraction
                record.fieldData['-recordId'] = record.recordId;
              }
              toRet.push(util.dataToLocal(record.fieldData, conf.fieldTypes, conf.fieldNames));
              lastRecordId = record.recordId;
            })
            //hasMoreRecords = toRet.length < pageSize ? false : true;
            table.appendRows(toRet)
            doneCallback()
            //We intentionally pass an object contains lastRecordId via tableau.dataCallback to make it look different at the first loop.
            //tableau.dataCallback(toRet, JSON.stringify({lastRecordId:lastRecordId}), hasMoreRecords);
          } else {
            if(lastRecordId == 0){
              return tableau.abortWithError(lang.Error_No_Results_Found);
            }
            tableau.dataCallback([], lastRecordToken, false);
          }

        } else {
          tableau.abortWithError(lang.Error_Failed_To_Fetch_Data + " : " + xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        if(xhr.readyState===4 && xhr.responseText.indexOf("952")>-1){//handle Invalid token
          //If FM session expired during Tableau extracting data, we can relogin FM and pickup from lastRecordId.
          fmConnector.FMLogin(lastRecordId.toString());
        }
        else{
          tableau.abortWithError(lang.Error_Failed_To_Fetch_Data + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
        }
      }
    });
  };

  //store field names, types and other resource metaData into tableau.connectionData
  fmConnector.parseMetaData = function(metaData){
    var dataTypesMap = {"text":"string", "bool":"bool", "date":"date", "time":"string", "timestamp":"datetime", "number":"float", "int":"int"};
    var connectionConf  = JSON.parse(tableau.connectionData);

    var fields = []
    metaData.forEach(function(meta){
      if(fields.indexOf(meta.name) == -1){ //skip duplicated field if it is already included
        fields.push({id:meta.name, dataType:dataTypesMap[meta.result]})
      }
    })

    if(connectionConf.incremental){
      fields.push({id:'-recordId', dataType:'int'})
      //-recordId must be included for incremental extraction.
    }

    return fields;
  };

  fmConnector.getMetaData = function(layout){
    var connectionConf  = JSON.parse(tableau.connectionData);
    var connectionUrl = connectionConf.apiPath + "databases/"+encodeURIComponent(connectionConf.solution) +"/layouts/"+encodeURIComponent(layout)+"/metadata";
    var passwordObj = fmConnector.getPasswordObj();
    var xhr = $.ajax({
      url: connectionUrl,
      type:"GET",
      headers: {"Authorization": "Bearer " + passwordObj.token},
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          if(res.response.metaData.length==0){
            throw new Error(lang.Error_Get_Meta_Data_Failed +": "+ xhr.responseText);
          }else{
            return fmConnector.parseMetaData(res.response.metaData);
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
  }

  fmConnector.createDataCursor = function(layout) {
    ///lastRecordToken is a string so it need to converted to number to match recordId data type.
    var conf  = JSON.parse(tableau.connectionData);
    var passwordObj = fmConnector.getPasswordObj();
    // calling createCursor api
    var connectionUrl = conf.apiPath +"databases/" + encodeURIComponent(conf.solution) +"/layouts/" + encodeURIComponent(layout) + "/cursor";
    //console.log("CREATE CUSRSOR TOKEN ");
    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: {"Authorization": "Bearer " + passwordObj.token},
      type:"POST",
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          passwordObj.cursors[layout] = res.response.cursorToken;
          tableau.password = JSON.stringify(passwordObj);
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
    var passwordObj = fmConnector.getPasswordObj();
    // calling createCursor api
    var connectionUrl = conf.apiPath +"databases/" + encodeURIComponent(conf.solution) +"/layouts/" + encodeURIComponent(layout) + "/cursor/reset";
    //console.log("RESET CUSRSOR ");

    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: {"Authorization": "Bearer " + passwordObj.token, "X-FM-Data-Cursor-Token":passwordObj.cursorToken },
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

  fmConnector.shutdown = function() {
    //In case of re-login cuased by expried token durign gatehrData phase,
    //new token can't be updated into tableau.password and won't be reusable when this connector was reloaded.
    //We have to enforce logout for each shutdown after re-login to avoid creating idel FM session.
    if(tableau.phase === tableau.phaseEnum.gatherDataPhase && fmConnector.reLogin){
      var passwordObj = fmConnector.getPasswordObj();
      var connectionConf  = JSON.parse(tableau.connectionData);
      var connectionUrl = connectionConf.apiPath + "databases/"+encodeURIComponent(connectionConf.solution)+"/sessions";
      var xhr = $.ajax({
        url: connectionUrl,
        type:"DELETE",
        headers: {"Authorization": "Bearer " + passwordObj.token},
        success: function (res, textStatus, xhr) {
          tableau.shutdownCallback();
        },
        error: function (xhr, textStatus, thrownError) {
          tableau.abortWithError(lang.Error_Logout_Failed + " : " +util.makeErrorMessage(xhr, textStatus, thrownError));
          tableau.shutdownCallback();
        }
      })
    }else{
      tableau.shutdownCallback();
    }

  }

  /* helper functions */
  fmConnector.getPasswordObj = function(){
    if(!tableau.password){
      return tableau.abortWithError(lang.Error_Missing_Password_Object );
    }
    var passwordObj = JSON.parse(tableau.password);
    if(tableau.phase === tableau.phaseEnum.gatherDataPhase){
      if(!passwordObj.token){
        return tableau.abortWithError(lang.Error_Missing_Session_Token  );
      }
      if(!passwordObj.cursorToken){
        return tableau.abortWithError(lang.Error_Missing_Cursor_Token );
      }
    }
    return passwordObj;
  }

  //The optional string parameter lastRecordToken indicates that the wip session expired during Tableau extracting data.
  fmConnector.FMLogin = function(lastRecordToken) {
    var passwordObj = fmConnector.getPasswordObj();
    var connectionConf  = JSON.parse(tableau.connectionData);
    var connectionUrl = connectionConf.apiPath + "databases/"+encodeURIComponent(connectionConf.solution)+"/sessions";
    if(connectionConf.loginType === "oauth"){
      var headers = {
        "X-FM-Data-OAuth-Request-Id":passwordObj.oAuthRequestId,
        "X-FM-Data-OAuth-Identifier":passwordObj.oAuthIdentifier
      };

    }else{//Regular login with FM account
      var headers = {
        "Authorization": "Basic " + window.btoa(tableau.username+':'+passwordObj.password) // will window.btoa actually work??
      };
    }
    var xhr = $.ajax({
      url: connectionUrl,
      dataType: 'json',
      contentType: "application/json",
      headers: headers,
      type:"POST",
      data: {},
      success: function (res, textStatus, xhr) {
        if (res.messages && res.messages[0].code === '0') {
          try{
            passwordObj.token = xhr.getResponseHeader('x-fm-data-access-token');
            tableau.password = JSON.stringify(passwordObj);
            fmConnector.createDataCursor();
            if(tableau.phase === tableau.phaseEnum.gatherDataPhase){
              fmConnector.reLogin = true;
              //Re-login during a Tableau session, skip setup metadata and getTableData directly
              fmConnector.getTableData(lastRecordToken);
            }else{
              fmConnector.getMetaData();
              $('#loader').hide();
              tableau.submit();
            }
          }catch(err){
            $('#loader').hide();
            return tableau.abortWithError(err.message);
          }
        } else {
          return tableau.abortWithError(lang.Error_Login_Failed +": " + xhr.responseText);
        }
      },
      error: function (xhr, textStatus, thrownError) {
        $('#loader').hide();
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
      tableau.connectionData = JSON.stringify(connectionConf);
      tableau.username = $('#user').val().trim();
      tableau.password = JSON.stringify({password: $('#password').val().trim(), token:''});

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