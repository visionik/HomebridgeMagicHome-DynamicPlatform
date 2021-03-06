import { CharacteristicEventTypes } from 'homebridge';
import type {
  Service, PlatformConfig, PlatformAccessory, CharacteristicValue,
  CharacteristicSetCallback, CharacteristicGetCallback,
} from 'homebridge';
import { clamp, convertHSLtoRGB, convertRGBtoHSL } from './magichome-interface/utils';
import { HomebridgeMagichomeDynamicPlatform } from './platform';
import { Transport } from './magichome-interface/transport';

const COMMAND_POWER_ON = [0x71, 0x23, 0x0f];
const COMMAND_POWER_OFF = [0x71, 0x24, 0x0f];

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomebridgeMagichomeDynamicPlatformAccessory {
  private service: Service;
  private transport = new Transport(this.accessory.context.cachedIPAddress, this.config);

  private colorWhiteThreshold = this.config.settings.whiteEffects.colorWhiteThreshold;
  private colorWhiteThresholdSimultaniousDevices = this.config.settings.whiteEffects.colorWhiteThresholdSimultaniousDevices;
  private colorOffThresholdSimultaniousDevices = this.config.settings.whiteEffects.colorOffThresholdSimultaniousDevices;
  private simultaniousDevicesColorWhite = this.config.settings.whiteEffects.simultaniousDevicesColorWhite;
  private isActive = false;
  private lightState = {
    HSL: { Hue: 255, Saturation: 100, Luminance: 50 },
    On: true,
    Brightness: 100,
  }



  constructor(
    private readonly platform: HomebridgeMagichomeDynamicPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly config: PlatformConfig,
  ) {
    

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!

      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Magic Home')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uniqueId)
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.modelNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.lightVersion)
      .getCharacteristic(this.platform.Characteristic.Identify)
      .on(CharacteristicEventTypes.SET, this.identifyLight.bind(this));       // SET - bind to the 'Identify` method below

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);


    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) ?? this.accessory.addService(this.platform.Service.Lightbulb);

    this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .on(CharacteristicEventTypes.SET, this.setConfiguredName.bind(this));
    // To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    // when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    // this.accessory.getService('NAME') ?? this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE');

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the Hue Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .on(CharacteristicEventTypes.SET, this.setHue.bind(this))               // SET - bind to the 'setHue` method below
      .on(CharacteristicEventTypes.GET, this.getHue.bind(this));              // GET - bind to the 'getHue` method below

    // register handlers for the Saturation Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .on(CharacteristicEventTypes.SET, this.setSaturation.bind(this));        // SET - bind to the 'setSaturation` method below
    //.on(CharacteristicEventTypes.GET, this.getSaturation.bind(this));       // GET - bind to the 'getSaturation` method below

    // register handlers for the Brightness Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .on(CharacteristicEventTypes.SET, this.setBrightness.bind(this))        // SET - bind to the 'setBrightness` method below
      .on(CharacteristicEventTypes.GET, this.getBrightness.bind(this));       // GET - bind to the 'getBrightness` method below

    this.getState();
  }


  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  setConfiguredName(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    const name: string = value.toString();
    this.platform.log.debug('Renaming device to %o', name);
    this.accessory.context.displayName = name;
    this.platform.api.updatePlatformAccessories([this.accessory]);



    callback(null);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  getActive(callback: CharacteristicGetCallback) {
    this.platform.log.debug('setting active');

    callback(null, this.isActive);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  identifyLight() {
    this.platform.log.debug('Identifying accessory!');
    this.flashEffect();

  }


  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  async setHue(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to set the brightness
    this.lightState.HSL.Hue = value as number;

    await this.setColor();

    this.platform.log.debug('Set Characteristic Hue -> ', value);

    // you must call the callback function
    callback(null);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  async setSaturation(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to set the brightness
    this.lightState.HSL.Saturation = value as number;

    await this.setColor();

    this.platform.log.debug('Set Characteristic Saturation -> %o for device: %o ', value, this.accessory.context.device.uniqueId);

    // you must call the callback function
    callback(null);
  }

  /*
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Hue
   */
  async setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to set the brightness
    this.lightState.Brightness = value as number;

    await this.setColor();
    this.platform.log.debug('Set Characteristic Brightness -> %o for device: %o ', value, this.accessory.context.device.uniqueId);

    // you must call the callback function
    callback(null);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {


    this.lightState.On = value as boolean;
    this.send(this.lightState.On ? COMMAND_POWER_ON : COMMAND_POWER_OFF);

    this.platform.log.debug('Set Characteristic On -> %o for device: %o ', value, this.accessory.context.device.uniqueId);

    // you must call the callback function
    callback(null);
  }

  //=================================================
  // Start Getters //

  getHue(callback: CharacteristicGetCallback) {

    const hue = this.lightState.HSL.Hue;

    //update state with actual values asynchronously
    this.getState();

    this.platform.log.debug('Get Characteristic Hue -> %o for device: %o ', hue, this.accessory.context.device.uniqueId);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, hue);
  }

  /*
  getSaturation(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const saturation = this.lightState.HSL.Saturation;
    
    //update state with actual values asynchronously
    this.getState();

    this.platform.log.debug('Get Characteristic Saturation -> %o for device: %o ', saturation, this.accessory.context.device.uniqueId);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, saturation);
  }
*/
  getBrightness(callback: CharacteristicGetCallback) {

    // implement your own code to check if the device is on
    const brightness = this.lightState.Brightness;

    // dont update the actual values from brightness, it is impossible to determine by rgb values alone
    //this.getState();

    this.platform.log.debug('Get Characteristic Brightness -> %o for device: %o ', brightness, this.accessory.context.device.uniqueId);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, brightness);
  }

  /**
   ** @getOn
   * instantly retrieve the current on/off state stored in our object
   * next call this.getState() which will update all values asynchronously as they are ready
   */
  getOn(callback: CharacteristicGetCallback) {

    const isOn = this.lightState.On;

    //update state with actual values asynchronously
    this.getState();

    this.platform.log.debug('Get Characteristic On -> %o for device: %o ', isOn, this.accessory.context.device.uniqueId);
    callback(null, isOn);
  }

  //=================================================
  // End Getters //

  //=================================================
  // Start State Get/Set //

  /**
   ** @getState
   * retrieve light's state object from transport class
   * once values are available, update homekit with actual values
   */
  async getState() {

    try {


      const state = await this.transport.getState(1000); //retrieve a state object from transport class showing light's current r,g,b,ww,cw, etc

      const { red, green, blue } = state.color; //create local constant for red, green, blue
      const [hue, saturation] = convertRGBtoHSL(red, green, blue);  //convert retrieved RGB values to hsl as homehit only uses hsl
      //luminance is never read

      this.lightState.On = state.isOn;
      this.lightState.HSL.Hue = hue;
      this.lightState.HSL.Saturation = saturation;

      this.service.updateCharacteristic(this.platform.Characteristic.On, state.isOn);
      this.service.updateCharacteristic(this.platform.Characteristic.Hue, hue);
      this.service.updateCharacteristic(this.platform.Characteristic.Saturation, saturation);
      //we never update Luminance as we use 'brightness' to determine each LED's power
      //brightness is returned instantly in "getBrightness()" 
      //(todo) should probably calculate brightness from rgbww for initial values
      //(todo) should probably create global warmWhite and coldWhite values and determine current white mode (color, white, both)
      this.platform.log.debug('Getting state for accessory: %o version-%o',
        this.accessory.context.displayName, this.accessory.context.lightVersion);
      this.platform.log.debug('buffer data: ', state.debugBuffer);
    } catch (error) {
      this.platform.log.warn('getState() error: ', error);
    }
  }

  /**
   ** @setColor
   *  determine RGB and warmWhite/coldWhite values  from homekit's HSL
   *  perform different logic based on light's capabilities, detimined by "this.accessory.context.lightVersion"
   *  
   */
  async setColor() {


    //**** local variables ****\\
    const hsl = this.lightState.HSL;
    let [red, green, blue] = convertHSLtoRGB([hsl.Hue, hsl.Saturation, hsl.Luminance]); //convert HSL to RGB
    const whites = this.calculateWhiteColor(); //calculate the white colors as a function of hue and saturation. See "calculateWhiteColor()"
    const brightness = this.lightState.Brightness;

    this.platform.log.debug('Current HSL and Brightness: h:%o s:%o l:%o br:%o', hsl.Hue, hsl.Saturation, hsl.Luminance, brightness);
    this.platform.log.debug('Converted RGB: r:%o g:%o b:%o', red, green, blue);

    let mask = 0xF0; // the 'mask' byte tells the controller which LEDs to turn on color(0xF0), white (0x0F), or both (0xFF)
    //we default the mask to turn on color. Other values can still be set, they just wont turn on

    //sanitize our color/white values with Math.round and clamp between 0 and 255, not sure if either is needed
    //next determine brightness by dividing by 100 and multiplying it back in as brightness (0-100)
    let r = Math.round(((clamp(red, 0, 255) / 100) * brightness));
    let g = Math.round(((clamp(green, 0, 255) / 100) * brightness));
    let b = Math.round(((clamp(blue, 0, 255) / 100) * brightness));
    let ww = Math.round(((clamp(whites.warmWhite, 0, 255) / 100) * brightness));
    let cw = Math.round(((clamp(whites.coldWhite, 0, 255) / 100) * brightness));

    //****logic switch for light types****\\

    //different light types need different different logic as they all have different capablilities
    //(FINISHED)(todo) add rgb-only case for users with rgb only light strips. Will need to know light version number (FINISHED)
    switch (this.accessory.context.lightVersion) {

      case 11: //rgb REVERSED... needs the order of red and green switched
        this.send([0x31, g, r, b, 0x00, mask, 0x0F]); //8th byte checksum calculated later in send()
        break;

      case 4: //rgb NORMAL
        this.send([0x31, r, g, b, 0x00, mask, 0x0F]); //8th byte checksum calculated later in send()
        break;

      //light versions 8 and 9 have rgb and warmWhite capabilities
      case 9: //rgbw
      case 8: //rgbw

        //if saturation is below config set threshold or if user asks for warm white / cold white  
        //set all other values besides warmWhite to 0 and set the mask to white (0x0F)

        if ((hsl.Saturation < this.colorWhiteThreshold) 
        || (hsl.Hue == 31 && hsl.Saturation == 33) 
        || (hsl.Hue == 208 && hsl.Saturation == 17) 
        || (hsl.Hue == 0 && hsl.Saturation == 0)) {

          r = 0;
          g = 0;
          b = 0;
          ww = Math.round((255 / 100) * brightness);
          cw = 0;
          mask = 0x0F;
          this.platform.log.debug('Setting warmWhite only without colors: ww:%o', ww);

        } else { //else set warmWhite and coldWhite to zero. Color mask already set at top

          ww = 0;
          cw = 0;
          this.platform.log.debug('Setting colors without white: r:%o g:%o b:%o', r, g, b);
        }
        this.send([0x31, r, g, b, ww, mask, 0x0F]); //8th byte checksum calculated later in send()
        break;


      //light versions 7 and 5 have rgb, warmWhite and coldWhite capabilities.
      //only color OR white can be enabled at one time (no 0xFF mask). However, both whites can turn on simultaniously
      case 7: //rgbww color/white non-simultanious
      case 5: //rgbww color/white non-simultanious

        if (hsl.Hue == 31 && hsl.Saturation == 33) {
          r = 0;
          g = 0;
          b = 0;
          ww = Math.round((255 / 100) * brightness);
          cw = 0;
          mask = 0x0F;
          this.platform.log.debug('Setting warmWhite only without colors or coldWhite: ww:%o', ww);
        } else if (hsl.Hue == 208 && hsl.Saturation == 17) {
          r = 0;
          g = 0;
          b = 0;
          ww = 0;
          cw = Math.round((255 / 100) * brightness);
          mask = 0x0F;
          this.platform.log.debug('Setting coldWhite only without colors or warmWhite: cw:%o', cw);

          //if saturation is below config set threshold, set rgb to 0 and set the mask to white (0x0F). 
          //White colors were already calculated above
        } else if (hsl.Saturation < this.colorWhiteThreshold) {
          r = 0;
          g = 0;
          b = 0;
          mask = 0x0F;
          this.platform.log.debug('Setting warmWhite and coldWhite without colors: ww:%o cw:%o', ww, cw);
        } else { //else set warmWhite and coldWhite to zero. Color mask already set at top

          ww = 0;
          cw = 0;
          this.platform.log.debug('Setting colors without white: r:%o g:%o b:%o', r, g, b);

        }
        this.send([0x31, r, g, b, ww, cw, mask, 0x0F]); //9th byte checksum calculated later in send()
        break;

      //light version 3 has rgb, warmWhite and coldWhite capabilities.
      //both color AND white can be enabled simultaniously (0xFF mask is possible). Both whites can turn on simultaniously as well.
      case 3:  //rgbww simultanious color/white capable

        //set mask to both color/white (0xFF) so we can control both color and white simultaniously,
        mask = 0xFF;


        if (hsl.Hue == 31 && hsl.Saturation == 33) {

          r = 0;
          g = 0;
          b = 0;
          ww = Math.round((255 / 100) * brightness);
          cw = 0;
          mask = 0x0F;
          this.platform.log.debug('Setting warmWhite only without colors or coldWhite: ww:%o', ww);

        } else if (hsl.Hue == 208 && hsl.Saturation == 17) {
          r = 0;
          g = 0;
          b = 0;
          ww = 0;
          cw = Math.round((255 / 100) * brightness);
          mask = 0x0F;
          this.platform.log.debug('Setting coldWhite only without colors or warmWhite: cw:%o', cw);

          //if saturation is below config set threshold, set rgb to 0 and set the mask to white (0x0F). 
          //White colors were already calculated above
        } else if (hsl.Saturation < this.colorOffThresholdSimultaniousDevices) {
          this.platform.log.debug('Turning off color');
          r = 0;
          g = 0;
          b = 0;
          this.platform.log.debug('Setting only white: ww:%o cw:%o', ww, cw);

          //else if saturation is less than config set "colorWhiteThreshold" AND above "colorOffThreshold"
          //set RGB to 100% saturation and 100% brightness
          //this allows brightness to only affect the white colors, creating beautiful white+color balance
          //we've set the color saturation to 100% because the higher the white level the more washed out the colors become
          //the white brightness effectively acts as the saturation value
        } else if (hsl.Saturation < this.colorWhiteThresholdSimultaniousDevices && this.simultaniousDevicesColorWhite) {
          [red, green, blue] = convertHSLtoRGB([hsl.Hue, 100, hsl.Luminance]); //re-generate rgb with full saturation
          r = red;
          g = green;
          b = blue;
          this.platform.log.debug('Setting fully saturated color mixed with white: r:%o g:%o b:%o ww:%o cw:%o', r, g, b, ww, cw);

          //else saturation is greater than "colorWhiteThreshold" so we set ww and cw to 0 and only display the color LEDs
        } else {
          ww = 0;
          cw = 0;
          this.platform.log.debug('Setting colors without white: r:%o g:%o b:%o', r, g, b);
        }

        this.send([0x31, r, g, b, ww, cw, mask, 0x0F]); //9th byte checksum calculated later in send()
        break;

      //light version 10 has rgb and warmWhite capabilities.
      //both color AND white can be enabled simultaniously (0xFF mask is possible).
      case 10:  //rgbw simultanious color/white capable

        //set mask to both color/white (0xFF) so we can control both color and white simultaniously,
        mask = 0xFF;

        //if saturation is below config set threshold, set rgb to 0 and set the mask to white (0x0F). 
        if ((hsl.Hue == 31 && hsl.Saturation == 33) || (hsl.Hue == 208 && hsl.Saturation == 17) || (hsl.Hue == 0 && hsl.Saturation == 0) || (hsl.Saturation < this.colorOffThresholdSimultaniousDevices) ) {
          r = 0;
          g = 0;
          b = 0;
          ww = Math.round((255 / 100) * brightness);
          cw = 0;
          this.platform.log.debug('Setting warmWhite only without colors or coldWhite: ww:%o', ww);

          //else if saturation is less than config set "colorWhiteThreshold" AND above "colorOffThreshold"
          //set RGB to 100% saturation and 100% brightness
          //this allows brightness to only affect the white colors, creating beautiful white+color balance
          //we've set the color saturation to 100% because the higher the white level the more washed out the colors become
          //the white brightness effectively acts as the saturation value
        } else if (hsl.Saturation < this.colorWhiteThresholdSimultaniousDevices && this.simultaniousDevicesColorWhite) {
          [red, green, blue] = convertHSLtoRGB([hsl.Hue, 100, hsl.Luminance]); //re-generate rgb with full saturation
          r = red;
          g = green;
          b = blue;
          ww = Math.round((255 / 100) * brightness);
          cw = 0;
          this.platform.log.debug('Setting fully saturated color mixed with white: r:%o g:%o b:%o ww:%o', r, g, b, ww);

          //else saturation is greater than "colorWhiteThreshold" so we set ww and cw to 0 and only display the color LEDs
        } else {
          ww = 0;
          cw = 0;
          this.platform.log.debug('Setting colors without white: r:%o g:%o b:%o', r, g, b);
        }

        this.send([0x31, r, g, b, ww, mask, 0x0F]); //8th byte checksum calculated later in send()
        break;

      //warn user if we encounter an unknown light type
      default:
        this.platform.log.warn('Uknown light version: %o... color probably cannot be set. Trying anyway...', this.accessory.context.lightVersion);
        this.send([0x31, r, g, b, 0x00, mask, 0x0F]); //8th byte checksum calculated later in send()
        this.platform.log.warn('Please create an issue at https://github.com/Zacknetic/HomebridgeMagicHome-DynamicPlatform/issues and post your log.txt');
        break;


    }

  }//setColor

  //=================================================
  // End State Get/Set //

  //=================================================
  // Start Misc Tools //

  /**
   ** @calculateWhiteColor
   *  determine warmWhite/coldWhite values from hue
   *  the closer to 0/360 the weaker coldWhite brightness becomes
   *  the closer to 180 the weaker warmWhite brightness becomes
   *  the closer to 90/270 the stronger both warmWhite and coldWhite become simultaniously
   *  @returns whites object
   */
  calculateWhiteColor() {
    const hsl = this.lightState.HSL;
    let multiplier = 0;
    const whites = { warmWhite: 0, coldWhite: 0 };


    if (hsl.Hue <= 90) {        //if hue is <= 90, warmWhite value is full and we determine the coldWhite value based on Hue
      whites.warmWhite = 255;
      multiplier = ((hsl.Hue / 90));
      whites.coldWhite = Math.round((255 * multiplier));
    } else if (hsl.Hue > 270) { //if hue is >270, warmWhite value is full and we determine the coldWhite value based on Hue
      whites.warmWhite = 255;
      multiplier = (1 - (hsl.Hue - 270) / 90);
      whites.coldWhite = Math.round((255 * multiplier));
    } else if (hsl.Hue > 180 && hsl.Hue <= 270) { //if hue is > 180 and <= 270, coldWhite value is full and we determine the warmWhite value based on Hue
      whites.coldWhite = 255;
      multiplier = ((hsl.Hue - 180) / 90);
      whites.warmWhite = Math.round((255 * multiplier));
    } else if (hsl.Hue > 90 && hsl.Hue <= 180) {//if hue is > 90 and <= 180, coldWhite value is full and we determine the warmWhite value based on Hue
      whites.coldWhite = 255;
      multiplier = (1 - (hsl.Hue - 90) / 90);
      whites.warmWhite = Math.round((255 * multiplier));
    }
    return whites;
  } //calculateWhiteColor


  async send(command: number[], useChecksum = true) {
    const buffer = Buffer.from(command);
    this.platform.log.debug('\nSending command -> %o for...\nAccessory %o \nModel: %o \nID: %o \nIP-Address: %o \nVersion %o \nVersion Modifier: %o\n',
      buffer,
      this.accessory.context.displayName,
      this.accessory.context.device.modelNumber,
      this.accessory.context.device.uniqueId,
      this.accessory.context.cachedIPAddress,
      this.accessory.context.device.lightVersion,
      this.accessory.context.device.lightVersionModifier);
    await this.transport.send(buffer, useChecksum);
  } //send

  //=================================================
  // End Misc Tools //

  //=================================================
  // Start LightEffects //

  flashEffect() {
    this.lightState.HSL.Hue = 100 as number;
    this.lightState.HSL.Saturation = 100 as number;

    let change = true;
    let count = 0;

    const interval = setInterval(() => {


      if (change) {
        this.lightState.Brightness = 0;

      } else {
        this.lightState.Brightness = 100;
      }

      change = !change;
      count++;
      this.setColor();

      if (count >= 10) {

        this.lightState.HSL.Hue = 0;
        this.lightState.HSL.Saturation = 5;
        this.lightState.Brightness = 100;
        this.setColor();
        clearInterval(interval);
        return;
      }
    }, 300);
  } //flashEffect

  rainbowEffect() {

    const interval = setInterval(() => {
      this.lightState.HSL.Hue = 100 as number;
      this.lightState.HSL.Saturation = 100 as number;
      let rainbowHue = 0;
      let count = 0;

      rainbowHue += 1;
      if (rainbowHue > 360) {
        rainbowHue = 0;
        count++;
      }
      this.lightState.HSL.Hue = rainbowHue as number;
      this.setColor();
      if (count >= 1) {

        this.lightState.HSL.Hue = 0;
        this.lightState.HSL.Saturation = 5;
        this.lightState.Brightness = 100;
        this.setColor();
        clearInterval(interval);
        return;
      }
    }, 500);

  } //rainbowEffect


  //=================================================
  // End LightEffects //


  speedToDelay(speed: number) {
    speed = clamp(speed, 0, 100);
    return (30 - ((speed / 100) * 30)) + 1;
  }

  /**
	 * Sets the controller to display one of the predefined patterns
	 * @param {String} pattern Name of the pattern
	 * @param {Number} speed between 0 and 100
	 * @param {function} callback 
	 * @returns {Promise<boolean>}
	 */
  setPattern(pattern: number, speed: number) {

    const delay = this.speedToDelay(speed);

    //const cmd_buf = Buffer.from();

    //const promise = new Promise((resolve, reject) => {
    this.send([0x61, pattern, delay, 0x0f]);
    //}).then(data => {
    //return (data.length > 0 || !this._options.ack.pattern); 
    //});

    // if (callback && typeof callback == 'function') {
    // promise.then(callback.bind(null, null), callback);
    //}

    //return promise;
  }


} // ZackneticMagichomePlatformAccessory class
