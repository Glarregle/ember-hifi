import Ember from 'ember';

const {
  assert,
  observer,
  get,
  set
} = Ember;

let ClassMethods = Ember.Mixin.create({
  setup() {
  },

  canPlay() {
    return true;
  }
});

let Sound = Ember.Object.extend(Ember.Evented, {
  logger: Ember.inject.service('debug-logger'),
  pollInterval: 1000,
  timeout: 2000,
  isLoading: false,
  isPlaying: false,
  position: 0,
  duration: 0,

  init: function() {
    this.on('audio-played',    () => {
      this.set('isLoading', false);
      this.set('isPlaying', true);
    });
    this.on('audio-paused',    () => this.set('isPlaying', false));
    this.on('audio-stopped',   () => this.set('isPlaying', false));

    this.on('audio-ready',    () => {
      this.set('duration', this.audioDuration());
      this.set('_didNotTimeOut', true);
    });

    this.on('audio-load-error',    () => {
      this.set('_didNotTimeOut', true);
    });

    this.on('audio-loaded', () => {
      this.set('isLoading', false);
    });

    this.on('audio-position-changed', (position) => {
      this.set('position', position);
    });

    Ember.run.later(() => {
      if (!this.get("_didNotTimeOut")) {
        this.trigger('audio-load-error', "request timed out");
      }
    }, this.get('timeout'));
  },

  /* To be defined on the subclass */

  _setVolume() {
    assert("[audio-pledge] #_setVolume interface not implemented", false);
  },

  currentPosition() {
    assert("[audio-pledge] #currentPosition interface not implemented", false);
  },

  setPosition() {
    assert("[audio-pledge] #setPosition interface not implemented", false);
  },

  play() {
    assert("[audio-pledge] #play interface not implemented", false);
  },

  pause() {
    assert("[audio-pledge] #pause interface not implemented", false);
  },

  stop() {
    assert("[audio-pledge] #stop interface not implemented", false);
  },

  forward() {
    assert("[audio-pledge] #forward interface not implemented", false);
  },

  rewind() {
    assert("[audio-pledge] #rewind interface not implemented", false);
  }
});

Sound.reopenClass(ClassMethods);

export default Sound;
