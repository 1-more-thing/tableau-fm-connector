
var util = {
  getCookie : function (cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for(var i = 0; i <ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length,c.length);
        }
    }
    return "";
  },

  removeCookie : function(cname){
    document.cookie = cname+"=; expires=Thu, 01 Jan 1970 00:00:01 GMT";
  },

  queryString : function () {
    var query_string = {};
    var query = window.location.search.substring(1);
    var vars = query.split("&");
    for (var i=0;i<vars.length;i++) {
      var pair = vars[i].split("=");
          // If first entry with this name
      if (typeof query_string[pair[0]] === "undefined") {
        query_string[pair[0]] = decodeURIComponent(pair[1]);
          // If second entry with this name
      } else if (typeof query_string[pair[0]] === "string") {
        var arr = [ query_string[pair[0]],decodeURIComponent(pair[1]) ];
        query_string[pair[0]] = arr;
          // If third or later entry with this name
      } else {
        query_string[pair[0]].push(decodeURIComponent(pair[1]));
      }
    }
    return query_string;
  },

  applyI18nString : function(){
    $("#Connecting").text(lang.Label_Connecting);
    $(".inputBoxTitle h3").text(lang.Title_Import_Data);
    $("#submitButton").text(lang.Btn_Import_Data);
    $("label[for=solutionName]").text(lang.Label_Source_Solution_Name);
    $("label[for=layoutName]").text(lang.Label_Source_Layout_Name);
    $("label[for=fm-user]").text(lang.Label_Account);
    $("label[for=fm-password]").text(lang.Label_Passwor);
    $("label[for=pageSize]").text(lang.Label_PageSize);
    $("label[for=incremental]").text(lang.Label_Incremental_Import);
    $("label[for=oauth_providers]").text(lang.Label_Login_With);
    $("#incrementalTP").text(lang.Tooltip_Enable_Incremental_Refresh);
    $("#oauth-required-label").text(lang.Label_Or);
  },

  makeErrorMessage : function(xhr, textStatus, thrownError){
    var message = textStatus + " : ";
    if(xhr.readyState===0){
      message = message+lang.Error_Connection_Failed
    }
    else if(thrownError){
      var showResponse = true;
      try{
        JSON.parse(xhr.responseText);
      }catch(e){
        showResponse = false;
      }
      message = message + thrownError + ' : '+(showResponse ?  xhr.responseText : lang.Error_Data_API_Server_Is_Down );
    }
    return message;
  },

  validateInput : function(){
    $('#solutionName').removeClass('missing');
    $('#layoutName').removeClass('missing');
    if(!$('#solutionName').val().trim()){
      $('#solutionName').addClass('missing');
      return false;
    }else if(!$('#layoutName').val().trim()){
      $('#layoutName').addClass('missing');
      return false;
    }
    return true;
  },

  hasRequiredInput : function(){
    return ($('#solutionName').val().trim()) && ($('#layoutName').val().trim());
  },

  enableBtnOnInput : function(){
    if(util.hasRequiredInput()){
      $("#submitButton").prop('disabled', false);
    }else{
      $("#submitButton").prop('disabled', true);
    }
  },

  dataToLocal : function(record, columns){
    var keys = Object.keys(record);

    var new_record = [];
    for (var j=0; j < keys.length; j++) {
      var key = keys[j].replace(/::/, "__");
      record[key] = record[keys[j]];
      delete record[keys[j]];
    }

    columns.forEach(function(column) {
      try{
        if ( column.dataType == 'date') {
            var d = record[column.id].split('/'); //["03", "15", "2017"]
          record[column.id] = d[2]+'-'+d[0]+'-'+d[1]; // Returns yyyy-MM-dd'
        } else if ( column.dataType == 'datetime') {
          var t = record[column.id].substr(10); // t = ' HH:mm:ss'
          var d = record[column.id].substr(0,10).split('/'); //["03", "15", "2017"]
          record[column.id] = d[2]+'-'+d[0]+'-'+d[1] + t; // Returns yyyy-MM-dd HH:mm:ss'
        }
      }catch(e){
        console.log("failed to convert date/datetime", e)
      }
    })

    /*var idx = fieldTypes.indexOf('date');
    while (idx != -1) {
      dateIndices.push(idx);
      idx = fieldTypes.indexOf('date', idx + 1);
    }

    idx = fieldTypes.indexOf('datetime');
    while (idx != -1) {
      datetimeIndices.push(idx);
      idx = fieldTypes.indexOf('datetime', idx + 1);
    }

    dateIndices.forEach(function(i){  //"03/15/2017" -> 'yyyy-MM-dd'
      try{
        var d = record[fieldNames[i]].split('/'); //["03", "15", "2017"]
        record[fieldNames[i]] = d[2]+'-'+d[0]+'-'+d[1]; // Returns yyyy-MM-dd'
      }catch(e){
      }
    })

    datetimeIndices.forEach(function(i){ //"03/15/2017 14:33:55"  -> 'yyyy-MM-dd HH:mm:ss'
      try{
        var t = record[fieldNames[i]].substr(10); // t = ' HH:mm:ss'
        var d = record[fieldNames[i]].substr(0,10).split('/'); //["03", "15", "2017"]
        record[fieldNames[i]] = d[2]+'-'+d[0]+'-'+d[1] + t; // Returns yyyy-MM-dd HH:mm:ss'
      }catch(e){
      }
    })*/

    return record;
  }
}
