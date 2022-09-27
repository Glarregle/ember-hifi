import Service from 'ember-hifi/services/hifi';
import DummyConnection from 'ember-hifi/hifi-connections/dummy-connection';
import hifiNeeds from './hifi-needs';

const dummyHifi = Service.extend({
  init: function() {
    this._super(...arguments);
    this.set('options', {
      emberHifi: {
        connections: [{
          name: 'DummyConnection',
          config: {
            testOption: 'DummyConnection'
          }
        }]
      }
    });
  },
  _lookupConnection: function() {
    return DummyConnection;
  }
});


export {
  DummyConnection,
  dummyHifi,
  hifiNeeds
};
