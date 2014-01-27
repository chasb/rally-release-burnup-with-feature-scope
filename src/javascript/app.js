Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    alternate_pi_size_field: 'c_PIPlanEstimate',
    alternate_wp_size_field: 'PlanEstimate',
    defaults: { padding: 5, margin: 5 },
    items: [
        {xtype:'container',itemId:'selector_box'},
        {xtype:'container',itemId:'chart_box'},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
        this._addReleaseSelector(this.down('#selector_box'));
    },
    _addReleaseSelector: function(container) {
        container.add({
            xtype:'rallyreleasecombobox',
            listeners: {
                scope: this,
                change: function(rb, new_value, old_value) {
                    this._getReleaseOids(rb.getRecord().get('Name')).then({
                        scope: this,
                        success: function(records) {
                            var start_date = rb.getRecord().get(rb.getStartDateField());
                            var end_date = rb.getRecord().get(rb.getEndDateField());
                            this._getData(records,start_date,end_date);
                        }
                    });
                }
            }
        });
    },
    _getReleaseOids: function(release_name) {
        this.logger.log("_getReleaseOids");
        var deferred = Ext.create('Deft.Deferred');
        Ext.create('Rally.data.wsapi.Store',{
            model:'Release',
            fetch: ['ObjectID'],
            filters: [{property:'Name',value:release_name}],
            autoLoad: true,
            listeners: {
                scope: this,
                load: function(store,releases){
                    var release_oids = [];
                    Ext.Array.each(releases,function(release){
                        release_oids.push(release.get('ObjectID'));
                    });
                    deferred.resolve( release_oids );
                }
            }
        });
        return deferred;
    },
    _getData: function(release_oids,start_date,end_date) {
        this.logger.log("_getData",release_oids,start_date,end_date);
        this._getFeatureScope(release_oids,start_date,end_date,this.alternate_pi_size_field);
        //this._getFieldChanges(release_oids,start_date,end_date,this.alternate_pi_size_field);
    },
    _getFeatureScope: function(release_oids,start_date,end_date,field_name){
        this.logger.log("_getFeatureScope");
        var me = this;
        this._mask("Loading Historical Data");

        this.config = {
            start_date:start_date,
            end_date:end_date,
            day_to_week_switch_point: 30,
            baseline_field_name: field_name,
            release_oids: release_oids,
            model_types: ['HierarchicalRequirement','Defect','TestSet','PortfolioItem']
        };
        var config = this.config;
        this.logger.log("Getting array of days ",config.start_date,config.end_date,true,config.day_to_week_switch_point);
        var array_of_days = Rally.technicalservices.util.Utilities.arrayOfDaysBetween(config.start_date,config.end_date,true,config.day_to_week_switch_point);
        var promises = _.map(array_of_days,me._getSnapshots,this);
        
        Deft.Promise.all(promises).then({
            scope: this,
            success: function(days) {
                // got back an array of calculated data for each day (tsday model) (plus the null back from the other call)
                me._unmask();
                me._makeChart(days);
            }, 
            failure: function(records) {
                console.log("oops");
            }
        });
    },
    _getSnapshots:function(day){
        var me = this;
        var config = this.config;
        
        var deferred = Ext.create('Deft.Deferred');
        
        this.logger.log("fetching snapshots at ", day);
        var project = this.getContext().getProject().ObjectID;
        var day_calculator = Ext.create('TSDay',{
            piSizeFieldName: me.alternate_pi_size_field,
            wpSizeFieldName: me.alternate_wp_size_field,
            JSDate: day
        });
        
        if ( day < new Date() ) {
            this.logger.log("creating store");
            Ext.create('Rally.data.lookback.SnapshotStore',{
                fetch: [me.alternate_pi_size_field,me.alternate_wp_size_field,"_TypeHierarchy","ScheduleState"],
                hydrate: ['_TypeHierarchy','ScheduleState'],
                autoLoad: true,
                filters: [
                    {property:'Release',operator:'in',value:config.release_oids},
                    {property:'_TypeHierarchy',operator:'in',value:config.model_types},
                    {property:'__At',operator:'=',value:Rally.util.DateTime.toIsoString(day)},
                    {property:'_ProjectHierarchy', value:project}
                ],
                listeners: {
                    load: function(store,snaps,success){
                        if (success) {
                            this.logger.log("snaps",snaps);
    
                            Ext.Array.each(snaps, function(snap){
                                day_calculator.addSnap(snap);
                            });
                            deferred.resolve(day_calculator);
                        } else {
                            deferred.reject("Error Loading Snapshots for " + day);
                        }
                    },
                    scope: this
                }
            });
            return deferred.promise;
        } else {
            this.logger.log("Ignoring because after today");
            return day_calculator;
        }
    },
    _makeChart: function(days){
        this.logger.log("_makeChart",days);
        var config = this.config;
        var categories = this._getCategories(days);
        var series = this._getSeries(days);
        var increment = this._getIncrement(days);

        this.down('#chart_box').removeAll();
        if ( categories[0] > new Date() ) {
            this.down('#chart_box').add({
                xtype:'container',
                html:'Release has not yet started'
            });
            this._unmask();
        } else {
            this.down('#chart_box').add({
                xtype:'rallychart',
                chartData: {
                    series: series
                },
                chartConfig: {
                    chart: { type: 'area' },
                    title: { text: 'Release Burn Up', align: 'center' },
                    xAxis: [{
                        categories: categories,
                        labels: {
                            align: 'left',
                            rotation: 70,
                            formatter: function() {
                                if ( increment < 1 ) {
                                    return Ext.Date.format(this.value,'H:i');
                                }
                                return Ext.Date.format(this.value,'d-M');
                            }
                        }
                    }],
                    yAxis: [ { title: {text: 'Points'} }],
                    plotOptions: {
                        series: {
                            marker: { enabled: false }
                        }
                    }
                }
            });
        }        
    },
    _getCategories: function(days){
        this.logger.log("_getCategories");
        var categories = [];
        Ext.Array.each(days,function(day){
            categories.push(day.get('JSDate'));
        });
        return categories;
    },
    _getSeries: function(days){
        this.logger.log("_getSeries");
        var series = [];
        
        var pi_size_data = [];
        var wp_size_data = [];
        var wp_accepted_data = [];
        
        Ext.Array.each(days, function(day){
            var pi_size = day.get('piSizeTotal');
            var wp_size = day.get('wpSizeTotal');
            var wp_accepted_size = day.get('wpAcceptedTotal');
            if ( day.get('JSDate') > new Date() ) {
                pi_size = null;
                wp_size = null;
                wp_accepted_size = null;
            }
            pi_size_data.push(pi_size);
            wp_size_data.push(wp_size);
            wp_accepted_data.push(wp_accepted_size);
        });
        
        series.push({type:'line',name:'Feature Scope',data:pi_size_data});
        series.push({type:'line',name:'WorkProduct Scope',data:wp_size_data});
        series.push({type:'area',name:'WorkProduct Burn Up',data:wp_accepted_data});

        return series;
    },
    /*
     * determine what the distance between two x values is
     */
    _getIncrement: function(days){
        this.logger.log("_getIncrement");
        var increment = 0;
        if ( days.length > 1 ) {
            increment = Rally.util.DateTime.getDifference(days[1].get('JSDate'),days[0].get('JSDate'),'day');
        }
        this.logger.log("Increment",increment);
        return increment;
    },
//    _getFieldChanges: function(release_oids,start_date,end_date,field_name){
//        var me = this;
//        var release_filter = Ext.create('Rally.data.lookback.QueryFilter',{property:'Release',operator:'in',value:release_oids});
//        var change_filter = Ext.create('Rally.data.lookback.QueryFilter',{property:'_ValidFrom',operator:'>',value:start_date}).and(
//            Ext.create('Rally.data.lookback.QueryFilter',{property:'_ValidFrom',operator:'<=',value:end_date})
//        );
//        var start_filter = Ext.create('Rally.data.lookback.QueryFilter',{property:'__At',value:start_date});
//        
//        var or_filters = change_filter.or(start_filter);
//        
//        var filters = release_filter.and(or_filters);
//        
//        Ext.create('Rally.data.lookback.SnapshotStore',{
//            filters: filters,
//            autoLoad: true,
//            fetch:['ObjectID','_PreviousValues',field_name,'_UnformattedID'],
//            sorters: [
//                {
//                    property: '_ValidFrom',
//                    direction: 'ASC'
//                }
//            ],
//            listeners: {
//                scope: this,
//                load: function(store, snaps, success) {
//                    this.logger.log('snaps ',snaps);
//                    var change_days = {}; // key is short iso date
//                    var start_iso = Rally.util.DateTime.toIsoString(start_date,false);
//                    var original_day = Rally.util.DateTime.add(start_date,"day",-1);
//                    var original_day_iso = Rally.util.DateTime.toIsoString(original_day,false).replace(/T.*$/,'');
//                    
//                    var total_original_estimate = 0;
//                    this.logger.log(' start ', start_iso, ' original day ', original_day_iso);
//                    Ext.Array.each(snaps,function(snap){
//                        var type = 'change';
//                        var size = snap.get(field_name) || 0;
//                        var snap_iso = snap.get('_ValidFrom');
//                        var shifted_snap = Rally.util.DateTime.toIsoString(Rally.util.DateTime.fromIsoString(snap_iso), false);
//                        var snap_day_iso = shifted_snap.replace(/T.*$/,"");
//                        
//                        if (  original_day_iso.localeCompare(snap_day_iso) == 1 ) {
//                            type = 'original';
//                            total_original_estimate += size;
//                            if ( !change_days[original_day_iso] ) {
//                                change_days[original_day_iso] = 0;
//                            }
//                            change_days[original_day_iso] += size;
//                        } else {
//                            var previous_values = snap.get('_PreviousValues');
//                            // undefined means it wasn't the field that changed
//                            // null means it went from nothing to the new value
//                            // (assuming that size is actually something)
//                            if ( typeof(previous_values[field_name]) == 'undefined' ) {
//                                type = 'no change';
//                            } else {
//                                var previous_size = previous_values[field_name] || 0;
//                                var delta = size - previous_size;
//                                if ( !change_days[snap_day_iso] ) {
//                                    change_days[snap_day_iso] = 0;
//                                }
//                                change_days[snap_day_iso] += delta;
//                                total_original_estimate += delta;
//                            }
//                        }
//                        // TODO: get something for dealing with leaving release
//                        me.logger.log(' -- ', snap.get('_UnformattedID'), snap_day_iso, type );
//                    });
//                    me.logger.log(' done: ', change_days);
//                }
//            }
//        });
//    },
    _mask: function(text) {
        this.logger.log("_mask");
        var me = this;
        setTimeout(function(){
            me.setLoading(text);
        },10);
    },
    _unmask: function() {
        var me = this;
        this.logger.log("_unmask");
        setTimeout(function(){
            me.setLoading(false);
        },10);
    }
});
