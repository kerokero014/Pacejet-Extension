// @module RDT.rdt_sca_pacejet.PJModule
define('RDT.rdt_sca_pacejet.PJModule.View'
,	[
	'rdt_rdt_sca_pacejet_pjmodule.tpl'
	
	,	'RDT.rdt_sca_pacejet.PJModule.SS2Model'
	
	,	'Backbone'
    ]
, function (
	rdt_rdt_sca_pacejet_pjmodule_tpl
	
	,	PJModuleSS2Model
	
	,	Backbone
)
{
    'use strict';

	// @class RDT.rdt_sca_pacejet.PJModule.View @extends Backbone.View
	return Backbone.View.extend({

		template: rdt_rdt_sca_pacejet_pjmodule_tpl

	,	initialize: function (options) {

			/*  Uncomment to test backend communication with an example service
				(you'll need to deploy and activate the extension first)
			*/

			// this.model = new PJModuleModel();
			// var self = this;
         	// this.model.fetch().done(function(result) {
			// 	self.message = result.message;
			// 	self.render();
      		// });
		}

	,	events: {
		}

	,	bindings: {
		}

	, 	childViews: {

		}

		//@method getContext @return RDT.rdt_sca_pacejet.PJModule.View.Context
	,	getContext: function getContext()
		{
			//@class RDT.rdt_sca_pacejet.PJModule.View.Context
			this.message = this.message || 'Hello World!!'
			return {
				message: this.message
			};
		}
	});
});
