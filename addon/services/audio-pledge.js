import Ember from 'ember';
import SoundCache from '../helpers/sound-cache';
import OneAtATime from '../helpers/one-at-a-time';
import getOwner from 'ember-getowner-polyfill';
import RSVP from 'rsvp';
import PromiseTry from '../utils/promise-try';
import Debug from '../utils/debug';
const {
  Service,
  computed,
  observer,
  getWithDefault,
  assert,
  get,
  set,
  A: emberArray,
  String: { dasherize }
} = Ember;

export default Service.extend(Ember.Evented, {
  currentSound:   null,
  isPlaying:      computed.readOnly('currentSound.isPlaying'),
  logger:         Ember.inject.service('debug-logger'),
  // TODO: add the following
  // isStream:
  // isFastForwardable: computed.readOnly('currentSound.canFastForward'),
  // isRewindable:      computed.readOnly('currentSound.canRewind'),
  //

  isLoading:      computed('currentSound.isLoading', {
    get() {
      return this.get('currentSound.isLoading');
    },
    set(k, v) { return v; }
  }),

  position:       computed.readOnly('currentSound.position'),
  duration:       computed.readOnly('currentSound.duration'),
  isMuted:        computed.equal('volume', 0),

  __updateAndPollPlayPosition: observer('isPlaying', 'isLoaded', function() {
     if (get(this, 'isPlaying')) {
       this.__setCurrentPosition();
       Ember.run.later(() =>  this.__updateAndPollPlayPosition(), get(this, 'pollInterval'));
     }
  }),

  __setCurrentPosition() {
    // currentPosition is defined on the subclass
    let sound = this.get('currentSound');
    set(sound, 'position', sound.currentPosition());
  },

  defaultVolume: 50,

  volume: computed({
    get() {
      return this.get('currentSound.volume') || this.get('defaultVolume');
    },
    set(k, v) {
      if (this.get('currentSound')) {
        this.get('currentSound')._setVolume(v);
      }

      return v;
    }
  }),

  /**
   * When the Service is created, activate factories that were specified in the
   * configuration. This config is injected into the Service as `options`.
   *
   * @method init
   * @param {Void}
   * @return {Void}
   */

  init() {
    const factories = getWithDefault(this, 'options.audioPledgeFactories', emberArray());
    const owner = getOwner(this);

    owner.registerOptionsForType('audio-pledge@audio-pledge-factory', { instantiate: false });
    owner.registerOptionsForType('audio-pledge-factory', { instantiate: false });

    set(this, 'appEnvironment', getWithDefault(this, 'options.environment', 'development'));
    set(this, '_factories', {});
    set(this, 'soundCache', new SoundCache());
    set(this, 'oneAtATime', new OneAtATime());
    set(this, 'volume', 50);
    this.activateFactories(factories);

    this.set('isReady', true);
    this._super(...arguments);
  },

  /**
   * Given an array of URLS, return a sound ready for playing
   *
   * @method load
   * @param {Array} urls
   * @returns {Promise.<Sound|error>} A sound that's ready to be played, or an error
   */

  load(urls, options) {
    // If a debugName isn't provided, make up a unique string for easier console spotting
    options = Ember.merge({
      debugName: Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 3)
    }, options);

    let promise = new RSVP.Promise((resolve, reject) => {
      // This needs to be an array containing no fluff
      var urlsToTry = Ember.makeArray(urls).uniq().reject(i => Ember.isEmpty(i));
      if (urlsToTry.length === 0) {
        reject({error: "Urls must be provided"});
      }

      let sound = this.get('soundCache').find(urlsToTry);
      if (sound) {
        resolve({sound});
      }
      else {
        this.set('isLoading', true);
        let search = this.loadWorkingAudio(urlsToTry, options);
        search.then(results  => resolve({sound: results.success, failures: results.failures}));
        search.catch(results => reject({failures: results.failures}));

        return search;
      }
    });

    promise.then(({sound}) => this.get('soundCache').cache(sound));

    // On audio-played this pauses all the other sounds. One at a time!
    promise.then(({sound}) => this.get('oneAtATime').register(sound));
    promise.then(({sound}) => sound.on('audio-played', () => this.setCurrentSound(sound)));

    return promise;
  },

  /**
   * Given an array of URLS, try each url, select a factory, and then
   * return the first thing that works
   *
   * @method loadWorkingAudio
   * @param {Array} urlsToTry
   * @returns {Promise.<Sound|error>} A sound that's ready to be played, or an error
   */

  loadWorkingAudio(urlsToTry, options) {
    let params = [];
    let logger = this.get('logger');
    let loggerName = options.debugName;

    logger.timeStart(loggerName, "loadWorkingAudio");
    urlsToTry.forEach(url => {
      return this.selectWorkingFactories(url).map(factory => {
        params.push({
          url: url,
          factory: factory
        });
      });
    });

    let promise = PromiseTry.findFirst(params, (param, returnSuccess, markAsFailure) => {
      let Factory = param.factory;
      let sound = Factory.create({url: param.url});
      logger.log(loggerName, `LOADING: [${Factory.toString()}] -> ${param.url}`);

      sound.one('audio-load-error', (error) => {
        param.error = error;
        markAsFailure(param);

        logger.log(loggerName, `ERROR: [${Factory.toString()}] -> ${error} (${param.url})`);
      });
      sound.one('audio-ready',      () => {
        returnSuccess(sound);

        logger.log(loggerName, `SUCCESS: [${Factory.toString()}] -> ${param.url}`);
      });
    });

    promise.finally(() => logger.timeEnd(loggerName, "loadWorkingAudio"));

    return promise;
  },

  setCurrentSound(sound) {
    this._unregisterEvents(this.get('currentSound'));
    this._registerEvents(sound);
    sound._setVolume(this.get('volume'));
    this.set('currentSound', sound);
  },

  /**
   * Given an array of URLS, return a sound and play it.
   *
   * @method load
   * @param {Array} urls
   * @returns {Promise.<Sound|error>} A sound that's ready to be played, or an error
   */

  play(urls, options) {
    let load = this.load(urls, options);
    load.then(({sound}) => sound.play());

    // We want to keep this chainable elsewhere
    return load;
  },

  /**
   * Pauses the current sound
   *
   * @method pause
   * @param {Void}
   * @returns {Void}
   */

  pause() {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));
    this.get('currentSound').pause();
  },

  /**
   * Pauses the current sound
   *
   * @method pause
   * @param {Void}
   * @returns {Void}
   */

  stop() {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));
    this.get('currentSound').stop();
  },

  /**
   * Toggles play/pause state of the current sound
   *
   * @method pause
   * @param {Void}
   * @returns {Void}
   */

  togglePause() {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));

    if (this.get('isPlaying')) {
      this.get('currentSound').pause();
    }
    else {
      this.get('currentSound').play();
    }
  },

  /**
   * Fast forwards current sound if able
   *
   * @method fastForward
   * @param {Integer} duration in ms
   * @returns {Void}
   */

  fastForward(duration) {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));

    this.get('currentSound').fastforward(duration);
  },


  /**
   * Rewinds current sound if able
   *
   * @method rewind
   * @param {Integer} duration in ms
   * @returns {Void}
   */

  rewind(duration) {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));

    this.get('currentSound').rewind(duration);
  },

  /**
   * Sets position of the playhead on the current sound
   *
   * @method setPosition
   * @param {Integer} duration in ms
   * @returns {Void}
   */

  setPosition(position) {
    assert('[audio-pledge] Nothing is playing.', this.get('currentSound'));

    this.get('currentSound').setPosition(position);
  },

  /**
   * Register events on a current sound. Audio events triggered on that sound
   * will be relayed and triggered on this service
   *
   * @method _registerEvents
   * @param {Object} sound
   * @private
   * @return {Void}
   */

  _registerEvents(sound) {
    sound.on('audio-played',  () => this.relayEvent('audio-played', sound));
    sound.on('audio-paused',  () => this.relayEvent('audio-paused', sound));
    sound.on('audio-stopped', () => this.relayEvent('audio-stopped', sound));
    sound.on('audio-loaded',  () => this.relayEvent('audio-loaded', sound));
    sound.on('audio-loading', () => this.relayEvent('audio-loading', sound));
  },

  /**
   * Register events on a current sound. Audio events triggered on that sound
   * will be relayed and triggered on this service
   *
   * @method _unregisterEvents
   * @param {Object} sound
   * @private
   * @return {Void}
   */

  _unregisterEvents(sound) {
    if (!sound) {
      return;
    }
    sound.off('audio-played',  () => this.relayEvent('audio-played', sound));
    sound.off('audio-paused',  () => this.relayEvent('audio-paused', sound));
    sound.off('audio-stopped', () => this.relayEvent('audio-stopped', sound));
    sound.off('audio-loaded',  () => this.relayEvent('audio-loaded', sound));
    sound.off('audio-loading', () => this.relayEvent('audio-loading', sound));
  },

  /**
   * Relays an audio event on the sound to an event on the service
   *
   * @method relayEvent
   * @param {String, Object} eventName, sound
   * @private
   * @return {Void}
   */

  relayEvent(eventName, sound) {
    // console.log(`${eventName} -> ${sound.get('url')}`);
    this.trigger(eventName, sound);
  },

  /**
   * Selects a compatiable factory based on the URL
   *
   * @method selectFactory
   * @param {Array} urls
   * @return [Factory] activated factories
   */

  selectWorkingFactories(url) {
    // Select a random factory for testing

    let factoryNames = Object.keys(this.get('_factories'));
    let factories = factoryNames.map(name => this.get(`_factories.${name}`));
    let selectedFactories = factories.filter(f => f.canPlay(url));

    return selectedFactories;
  },

  /**
   * Activates the factories as specified in the config options
   *
   * @method activateFactories
   * @param {Array} factoryOptions
   * @return {Object} instantiated factories
   */

  activateFactories(factoryOptions = []) {
   const cachedFactories = get(this, '_factories');
   const activatedFactories = {};

   factoryOptions
     .forEach((factoryOption) => {
       const { name } = factoryOption;
       const factory = cachedFactories[name] ? cachedFactories[name] : this._activateFactory(factoryOption);

       set(activatedFactories, name, factory);
     });

   return set(this, '_factories', activatedFactories);
  },

  _activateFactory({ name, config } = {}) {
    const Factory = this._lookupFactory(name);
    assert('[audio-pledge] Could not find audio factory ${name}.', name);
    Factory.setup(config);
    return Factory;
  },

  /**
   * Looks up the factory from the container. Prioritizes the consuming app's
   * factories over the addon's factories.
   *
   * @method _lookupFactory
   * @param {String} factoryName
   * @private
   * @return {Factory} a local factory or an factory from the addon
   */

  _lookupFactory(factoryName) {
    assert('[audio-pledge] Could not find audio factory without a name.', factoryName);

    const dasherizedFactoryName = dasherize(factoryName);
    const availableFactory = getOwner(this).lookup(`audio-pledge@audio-pledge-factory:${dasherizedFactoryName}`);
    const localFactory = getOwner(this).lookup(`audio-pledge-factory:${dasherizedFactoryName}`);

    assert(`[audio-pledge] Could not load audio factory ${dasherizedFactoryName}`, (localFactory || availableFactory));

    return localFactory ? localFactory : availableFactory;
  }
});
