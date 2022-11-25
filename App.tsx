/**
 * A stripped down custom launcher app.
 *
 * @format
 */

import React, {useState, useEffect} from 'react';
import {
  Alert,
  Button,
  FlatList,
  Linking,
  LogBox,
  PermissionsAndroid,
  Text,
  TextInput,
  TouchableNativeFeedback,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {TailwindProvider, useTailwind} from 'tailwind-rn';
import utilities from './tailwind.json';
import {NavigationContainer} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {createMaterialTopTabNavigator} from '@react-navigation/material-top-tabs';
import SendIntentAndroid from 'react-native-send-intent';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Contacts from 'react-native-contacts';
import CallLogs, {CallLog} from 'react-native-call-log';
import RNImmediatePhoneCall from 'react-native-immediate-phone-call';
import Torch from 'react-native-torch';
import {useForm, Controller} from 'react-hook-form';
// import CallDetectorManager from 'react-native-call-detection';
// import SendSMS from 'react-native-sms';
import {selectContactPhone} from 'react-native-select-contact';
// @ts-ignore
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scrollview';
import DeviceInfo from 'react-native-device-info';
import 'react-native-url-polyfill/auto';

const DEBUG = false;
const ALL_CONTACTS = false;
if (!DEBUG) {
  LogBox.ignoreLogs(['new NativeEventEmitter']);
  LogBox.ignoreAllLogs();
}

const PLAY_STORE_URL = 'market://launch?id=';
const UBER_URL_ROOT =
  'uber://?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=';
const LAUNCHER = 'shubh.ruthless'; // 'com.google.android.apps.nexuslauncher'
const SETTINGS = 'com.android.settings';
const MAGNIFIER = 'com.app2u.magnifier';
const INTERNET = 'com.android.chrome';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'March',
  'April',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];
const CALLS_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 30; // 1 month
const COLORS = {
  blue: '#219ebc',
  dark_blue: '#264653',
  green: '#2a9d8f',
  yellow: '#e9c46a',
  orange: '#f4a261',
  red: '#e76f51',
  grey: '#adb5bd',
  black: '#283618',
};

export enum Screen {
  Home = 'Home',
  Extras = 'Extras',
  ContactList = 'ContactList',
  CallLogList = 'CallLogList',
  Configure = 'Configure',
  HomeTab = 'HomeTab',
}
type StackParamList = {
  Home: {apps: App[]};
  Extras: {apps: App[]};
  ContactList: {app: App};
  CallLogList: {app: App};
  Configure: {defaults: AppData};
  HomeTab: undefined;
};

const RootStack = createNativeStackNavigator<StackParamList>();
const HomeTab = createMaterialTopTabNavigator();

type HomeProps = NativeStackScreenProps<StackParamList, Screen.Home>;
type ExtrasProps = NativeStackScreenProps<StackParamList, Screen.Extras>;
type ContactsProps = NativeStackScreenProps<StackParamList, Screen.ContactList>;
type CallLogProps = NativeStackScreenProps<StackParamList, Screen.CallLogList>;
type ConfigureProps = NativeStackScreenProps<StackParamList, Screen.Configure>;
type HomeTabProps = NativeStackScreenProps<StackParamList, Screen.HomeTab>;
type NavProp =
  | HomeProps['navigation']
  | ExtrasProps['navigation']
  | ContactsProps['navigation']
  | CallLogProps['navigation']
  | ConfigureProps['navigation']
  | HomeTabProps['navigation'];

let contactsCache: Contacts.Contact[] | undefined;

interface PhoneInfo {
  manufacturer: string;
  carrier: string;
}
let phoneInfoCache: PhoneInfo | undefined;

const APP_DATA_LABEL = '@AppData';
interface AppData {
  homeAddress: string;
  favMusicGenre: string;
  homepageUrl: string;
  // emerContact1: string;
}
const APP_DATA_DEFAULTS = {
  homeAddress: '',
  favMusicGenre: '',
  homepageUrl: '',
  // emerContact1: '',
};
let appDataCache: AppData | undefined;

const LOW_BATTERY = 0.1;
interface BatteryProp {
  icon: string;
  color: string;
  minLevel: number;
}
// Order matters
const BATTERY_PROPS: {[key: string]: BatteryProp} = {
  charging: {
    icon: 'battery-charging-full',
    color: '#06d6a0',
    minLevel: 0,
  },
  full: {
    icon: 'battery-full',
    color: '#06d6a0',
    minLevel: 0.5,
  },
  medium: {
    icon: 'battery-std',
    color: '#ffd166',
    minLevel: 0.15,
  },
  low: {
    icon: 'battery-alert',
    color: '#ef476f',
    minLevel: 0,
  },
};

interface App {
  key: string;
  name: string;
  icon: string;
  color: string;
  depPackage?: string; // Defaults to package if present.
  cbParams?: string[];

  // Pick one possible action to take.
  url?: string;
  package?: string;
  callback?: string; // Function must be exported.
  asyncCallback?: string; // Async function must be exported.

  // Open a new window to perform the action.
  screen?: Screen;
}

const APPS: App[] = [
  {
    key: 'weather',
    name: 'Weather',
    icon: 'wb-sunny',
    color: COLORS.yellow,
    url: 'dynact://velour/weather/ProxyActivity',
    depPackage: 'com.google.android.googlequicksearchbox',
  },
  {
    key: 'uber',
    name: 'Taxi Home',
    icon: 'local-taxi',
    color: COLORS.red,
    asyncCallback: 'uberHome',
    depPackage: 'com.ubercab',
  },
  {
    key: 'magnifier',
    name: 'Magnifier',
    icon: 'saved-search',
    color: COLORS.orange,
    asyncCallback: 'turnTorchOnAndMagnify',
  },
  {
    key: 'dial',
    name: 'Dialpad',
    icon: 'dialpad',
    color: COLORS.dark_blue,
    url: 'tel:',
  },
  {
    key: 'phone',
    name: 'Phone',
    icon: 'phone',
    color: COLORS.green,
    callback: 'callPhone',
    cbParams: [],
    screen: Screen.ContactList,
  },
  {
    key: 'texts',
    name: 'Text Msgs',
    icon: 'chat',
    color: COLORS.orange,
    package: 'com.google.android.apps.messaging',
  },
  {
    key: 'voicemail',
    name: 'Voicemail',
    icon: 'voicemail',
    color: COLORS.green,
    asyncCallback: 'openVoicemail',
  },
  {
    key: 'missed',
    name: 'Missed',
    icon: 'phone-missed',
    color: COLORS.red,
    callback: 'callPhone',
    cbParams: [],
    screen: Screen.CallLogList,
  },
  {
    key: 'camera',
    name: 'Camera',
    icon: 'photo-camera',
    color: COLORS.dark_blue,
    callback: 'openCamera',
  },
  {
    key: 'photos',
    name: 'Photos',
    icon: 'photo',
    color: COLORS.yellow,
    package: 'com.google.android.apps.photos',
  },
  {
    key: 'maps',
    name: 'Map Home',
    icon: 'map',
    color: COLORS.green,
    asyncCallback: 'mapHome',
    // url: `geo:${HOME_GPS.lat},${HOME_GPS.lon}`,
    depPackage: 'com.google.android.apps.maps',
  },
  {
    key: 'reminder',
    name: 'Reminders',
    icon: 'alarm',
    color: COLORS.red,
    package: 'in.smsoft.justremind', // 'com.google.android.deskclock'
  },
];

const EXTRA_APPS: App[] = [
  {
    key: 'news',
    name: 'News',
    icon: 'radio',
    color: COLORS.red,
    package: 'org.npr.one',
  },
  {
    key: 'settings',
    name: 'Settings',
    icon: 'settings',
    color: COLORS.dark_blue,
    screen: Screen.Configure,
  },
  {
    key: 'book',
    name: 'Books',
    icon: 'menu-book',
    color: COLORS.yellow,
    package: 'com.google.android.apps.books',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    icon: 'add-ic-call',
    color: COLORS.dark_blue,
    // TODO: Support having the country code in the contact's phone #
    url: 'whatsapp://send?phone=1', // 'https://wa.me/',
    depPackage: 'com.whatsapp',
    screen: Screen.ContactList,
  },
  {
    key: 'internet',
    name: 'Internet',
    icon: 'language',
    color: COLORS.green,
    asyncCallback: 'openHomepage',
    depPackage: INTERNET,
  },
  {
    key: 'music',
    name: 'Music',
    icon: 'headset',
    color: COLORS.yellow,
    asyncCallback: 'openSpotify',
    depPackage: 'com.spotify.music',
  },
  {
    key: 'calendar',
    name: 'Calendar',
    icon: 'calendar-today',
    color: COLORS.orange,
    package: 'com.google.android.calendar',
  },
  {
    key: 'email',
    name: 'Email',
    icon: 'email',
    color: COLORS.red,
    package: 'com.google.android.gm',
  },
  {
    key: 'calculator',
    name: 'Calculator',
    icon: 'calculate',
    color: COLORS.dark_blue,
    package: 'com.google.android.calculator',
  },
  {
    key: 'health',
    name: 'Health',
    icon: 'directions-run',
    color: COLORS.yellow,
    package: 'com.google.android.apps.fitness',
  },
  {
    key: 'solitaire',
    name: 'Solitaire',
    icon: 'auto-awesome-motion',
    color: COLORS.orange,
    package: 'com.potatojam.classic.solitaire.klondike',
  },
  {
    key: 'words',
    name: 'Word Game',
    icon: 'videogame-asset',
    color: COLORS.green,
    package: 'com.gsr.wordcross',
  },
];

const BACKGROUND_APPS: App[] = [
  {
    key: 'launcher',
    name: 'Original Launcher',
    icon: 'apps',
    color: COLORS.black,
    package: LAUNCHER,
  },
  {
    key: 'settings',
    name: 'Settings',
    icon: 'settings',
    color: COLORS.black,
    package: SETTINGS,
  },
  {
    key: 'locator',
    name: 'Find My Device',
    icon: 'location-searching',
    color: COLORS.black,
    package: 'com.google.android.apps.adm',
  },
  {
    key: 'magnifier',
    name: 'Magnifier & Flashlight',
    icon: 'search',
    color: COLORS.black,
    package: MAGNIFIER,
  },
];

function removeNonDigits(num: string): string {
  return num.replace(/[^0-9]/g, '');
}

export function openCamera() {
  SendIntentAndroid.openCamera();
}

export async function mapHome() {
  const data = await getAppData();
  if (data === null || !data.homeAddress) {
    SendIntentAndroid.openMaps('');
  } else {
    SendIntentAndroid.openMapsWithRoute(data.homeAddress, 'd');
  }
}

export async function uberHome() {
  const data = await getAppData();
  if (data === null || !data.homeAddress) {
    await Linking.openURL('uber://');
  } else {
    await Linking.openURL(UBER_URL_ROOT + encodeURIComponent(data.homeAddress));
  }
}

export async function openSpotify() {
  const data = await getAppData();
  if (data === null || !data.favMusicGenre) {
    await Linking.openURL('spotify://');
  } else {
    // TODO: filter down to playlists
    await Linking.openURL(
      `spotify://search/${encodeURIComponent(data.favMusicGenre)}`,
    );
  }
}

export async function turnTorchOnAndMagnify() {
  const cameraAllowed = await Torch.requestCameraPermission(
    'Camera Permissions',
    "Camera permissions are required to use the phone's flashlight.",
  );
  if (cameraAllowed) {
    await Torch.switchState(true);
  }
  if (await checkInstalled(MAGNIFIER)) {
    await SendIntentAndroid.openApp(MAGNIFIER, {});
  }
}

async function turnTorchOff() {
  try {
    const isTorchOn = await Torch.getStatus();
    if (isTorchOn) {
      await Torch.switchState(false);
    }
  } catch (e) {}
}

export async function openVoicemail() {
  const vmPkg = await pickVisualVoicemailApp();
  if (vmPkg) {
    if (await checkInstalled(vmPkg)) {
      await SendIntentAndroid.openApp(vmPkg, {});
    }
  } else {
    const vmNum = await SendIntentAndroid.getVoiceMailNumber();
    callPhone(vmNum);
  }
}

export async function pickAndCall() {
  const selection = await selectContactPhone();
  if (selection === null) {
    return;
  }
  const {contact, selectedPhone} = selection;
  console.log(
    `Selected phone number ${selectedPhone.number} from ${contact.name}`,
  );
  const num = removeNonDigits(selectedPhone.number);
  RNImmediatePhoneCall.immediatePhoneCall(num);
}

export function callPhone(phoneNum: string) {
  const num = removeNonDigits(phoneNum);
  RNImmediatePhoneCall.immediatePhoneCall(num);
}

export async function openHomepage(): Promise<void> {
  const data = await getAppData();
  if (data === null || !data.homepageUrl) {
    if (await checkInstalled(INTERNET)) {
      await SendIntentAndroid.openApp(INTERNET, {});
    }
  } else {
    await Linking.openURL(data.homepageUrl);
  }
}

function alert(msg: string) {
  if (DEBUG) {
    Alert.alert(msg);
  }
}

function alertAndWarn(msg: string) {
  console.warn(msg);
  alert(msg);
}

const Header = (props: {text: string}) => {
  const tailwind = useTailwind();
  tailwind('h-20 h-12'); // Pre-compile for the ternary
  const height = props.text.length > 20 ? 20 : 12;

  return (
    <View style={tailwind(`flex flex-none w-full h-${height} mt-4 mb-2`)}>
      <Text style={tailwind('text-4xl font-bold text-black text-center')}>
        {props.text}
      </Text>
    </View>
  );
};

function getDate(date: Date): string {
  return `${date.getMonth()}/${date.getDate()}/${date.getFullYear()}`;
}

function getTime(date: Date): string {
  let hrs = date.getHours() % 12;
  if (hrs === 0) {
    hrs = 12;
  }
  let mins = `${date.getMinutes()}`;
  if (mins.length === 1) {
    mins = `0${mins}`;
  }
  const meridiem = date.getHours() < 12 ? 'a' : 'p';
  return `${hrs}:${mins}${meridiem}`;
}

async function getMissedCalls(): Promise<CallLog[]> {
  let calls: CallLog[] = [];
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      {
        title: 'Show Missed Calls',
        message: 'This app would like to show your call logs.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      console.warn('Read contacts permission denied');
      return [];
    }

    const cutOffDate = Date.now() - CALLS_LOOKBACK_MS;
    // Received in descending order
    calls = await CallLogs.load(100, {
      minTimestamp: cutOffDate,
      types: 'MISSED',
    });
  } catch (err) {
    console.warn(err);
    alert('Unable to retrieve call logs');
  }
  if (calls.length === 0) {
    return [];
  }

  const today = getDate(new Date());
  // Reuse rawType to store the number of duplicates
  // Change the formatting in dateTime
  function processCall(call: CallLog): CallLog {
    call.rawType = 1;
    const dt = new Date(parseInt(call.timestamp, 10));
    const date = getDate(dt);
    const time = getTime(dt);
    if (date === today) {
      call.dateTime = time;
    } else {
      call.dateTime = `${date} ${time}`;
    }
    return call;
  }

  // Merge duplicate calls
  const mergedCalls = [processCall(calls[0])];
  for (let i = 1; i < calls.length; i++) {
    const lastCall = mergedCalls[mergedCalls.length - 1];
    if (lastCall.phoneNumber === calls[i].phoneNumber) {
      lastCall.rawType++; // inc counter
      if (calls[i].duration > lastCall.duration) {
        lastCall.duration = calls[i].duration; // store max duration
      }
    } else {
      if (!calls[i].name && !calls[i].phoneNumber) {
        continue;
      }
      calls[i].rawType = 1;
      mergedCalls.push(processCall(calls[i]));
    }
  }
  return mergedCalls;
}

const CallWidget = (props: {call: CallLog; app: App; navigation: NavProp}) => {
  const tailwind = useTailwind();
  // deep copy
  const app = JSON.parse(JSON.stringify(props.app));
  app.color = COLORS.red;
  app.screen = undefined;
  const tel = removeNonDigits(props.call.phoneNumber);
  if (app.url) {
    app.url = app.url + tel;
  }
  if (app.cbParams !== undefined) {
    app.cbParams.push(tel);
  }

  const name = props.call.name || props.call.phoneNumber;
  const dups = props.call.rawType > 1 ? ` (${props.call.rawType})` : '';
  let duration = '';
  if (props.call.duration > 0) {
    duration = `, ${Math.floor(props.call.duration / 60)}:${
      props.call.duration % 60
    }`;
  }
  app.name = `${name}${dups}\n${props.call.dateTime}${duration}`;
  app.icon = 'call-missed';

  return (
    <View
      style={tailwind(
        'flex w-full items-center m-1 border-b border-gray-600 bg-white',
      )}>
      <TouchableNativeFeedback
        key={app.key}
        onPress={async () => await handleApp(app, props.navigation)}>
        <View style={tailwind('flex-row')}>
          <View style={tailwind('w-1/6')}>
            <Icon name={app.icon} size={40} color={app.color} />
          </View>
          <View style={tailwind('w-5/6')}>
            <Text style={tailwind('text-xl font-bold text-black')}>
              {app.name}
            </Text>
          </View>
        </View>
      </TouchableNativeFeedback>
    </View>
  );
};

const CallLogPanel = ({navigation, route}: CallLogProps) => {
  const tailwind = useTailwind();

  const [missedCalls, setMissedCalls] = useState<CallLog[]>([]);
  useEffect(() => {
    getMissedCalls()
      .then(calls => setMissedCalls(calls))
      .catch(console.warn);
    // Only run on first render
  }, []);

  const renderItem = (props: {item: CallLog}) => (
    <CallWidget
      call={props.item}
      app={route.params.app}
      navigation={navigation}
    />
  );
  const keyExtractor = (item: CallLog, idx: number) => {
    return item.timestamp || idx.toString();
  };

  // itemHeight={40}
  return (
    <View style={tailwind('flex-1 bg-white')}>
      <Header text={route.params.app.name} />
      <FlatList
        data={missedCalls}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        maxToRenderPerBatch={25}
        updateCellsBatchingPeriod={100}
      />
    </View>
  );
};

async function getPhoneInfo(): Promise<PhoneInfo> {
  function parseResult(val?: string | null): string {
    if (!val || val === 'nil') {
      return '';
    }
    return val.toLowerCase();
  }

  if (phoneInfoCache !== undefined) {
    return phoneInfoCache;
  }
  try {
    phoneInfoCache = {
      manufacturer: parseResult(await DeviceInfo.getManufacturer()),
      carrier: parseResult(await DeviceInfo.getCarrier()),
    };
    console.log(`Retrieved phone info: ${JSON.stringify(phoneInfoCache)}`);
  } catch (err) {
    console.warn(err);
    phoneInfoCache = {
      manufacturer: '',
      carrier: '',
    };
  }
  return phoneInfoCache;
}

async function pickVisualVoicemailApp(): Promise<string | undefined> {
  const phoneInfo = await getPhoneInfo();

  // https://developers.google.com/zero-touch/resources/manufacturer-names
  if (phoneInfo.manufacturer === 'google') {
    return 'com.google.android.dialer';
  }

  // https://source.android.com/devices/tech/config/carrierid
  // https://android.googlesource.com/platform/packages/providers/TelephonyProvider/+/master/assets/latest_carrier_id/carrier_list.textpb
  // https://en.wikipedia.org/wiki/List_of_mobile_network_operators_of_the_Americas#United_States
  if (phoneInfo.carrier.startsWith('at&t')) {
    return 'com.att.mobile.android.vvm';
  } else if (phoneInfo.carrier.startsWith('t-mobile')) {
    return 'com.vna.service.vvm';
  } else if (phoneInfo.carrier.startsWith('sprint')) {
    return 'com.sprint.vvm';
  } else if (phoneInfo.carrier.startsWith('metropcs')) {
    return 'com.metropcs.service.vvm';
  } else if (phoneInfo.carrier.startsWith('cricket')) {
    return 'com.mizmowireless.vvm';
  } else if (
    phoneInfo.carrier.startsWith('dish') ||
    phoneInfo.carrier.startsWith('boost')
  ) {
    return 'com.dish.vvm';
  }

  if (phoneInfo.manufacturer === 'samsung') {
    return 'com.samsung.vvm.se';
  }

  return undefined;
}

async function getContacts(): Promise<Contacts.Contact[]> {
  if (contactsCache !== undefined) {
    return contactsCache;
  }
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      {
        title: 'Show Contacts',
        message: 'This app would like to show your contacts.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      console.warn('Read contacts permission denied');
      return [];
    }

    contactsCache = await Contacts.getAllWithoutPhotos();
    if (!contactsCache) {
      contactsCache = [];
    }
    contactsCache.sort((a, b) => {
      if (a.isStarred && !b.isStarred) {
        return -1;
      } else if (!a.isStarred && b.isStarred) {
        return 1;
      } else {
        return a.givenName > b.givenName ? 1 : -1;
      }
    });
    console.log(`${contactsCache.length} contacts retrieved.`);
  } catch (err) {
    console.warn(err);
    alert('Unable to retrieve contacts');
    contactsCache = [];
  }
  return contactsCache;
}

const Contact = (props: {
  contact: Contacts.Contact;
  app: App;
  navigation: NavProp;
}) => {
  const tailwind = useTailwind();
  // deep copy
  const app = JSON.parse(JSON.stringify(props.app));
  app.color = COLORS.green;
  app.screen = undefined;
  const tel = removeNonDigits(props.contact.phoneNumbers[0].number);
  if (app.url) {
    app.url = app.url + tel;
  }
  if (app.cbParams !== undefined) {
    app.cbParams.push(tel);
  }
  app.name = `${props.contact.isStarred ? '⭐  ' : ''}${
    props.contact.givenName
  } ${props.contact.familyName}`;
  // app.key = tel;
  app.icon = 'person';

  return (
    <View
      style={tailwind(
        'flex w-full items-center m-1 border-b border-gray-600 bg-white',
      )}>
      <TouchableNativeFeedback
        key={app.key}
        onPress={async () => await handleApp(app, props.navigation)}>
        <View style={tailwind('flex-row')}>
          <View style={tailwind('w-1/5')}>
            <Icon name={app.icon} size={40} color={app.color} />
          </View>
          <View style={tailwind('w-4/5')}>
            <Text style={tailwind('text-2xl font-bold text-black')}>
              {app.name}
            </Text>
          </View>
        </View>
      </TouchableNativeFeedback>
    </View>
  );
};

const ContactPanel = ({navigation, route}: ContactsProps) => {
  const tailwind = useTailwind();

  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  useEffect(() => {
    getContacts()
      .then(cnts => {
        setContacts(
          cnts.filter(
            cnt =>
              (ALL_CONTACTS || cnt.isStarred) &&
              cnt.phoneNumbers.length > 0 &&
              cnt.phoneNumbers[0].number &&
              cnt.givenName.length > 0 &&
              !['#', '*'].includes(cnt.givenName.charAt(0)),
          ),
        );
      })
      .catch(console.warn);
    // Only run on first render
  }, []);

  const renderItem = (props: {item: Contacts.Contact}) => (
    <Contact
      contact={props.item}
      app={route.params.app}
      navigation={navigation}
    />
  );
  const keyExtractor = (item: Contacts.Contact, idx: number) => {
    return item?.recordID?.toString() || idx.toString();
  };

  // itemHeight={40}
  return (
    <View style={tailwind('flex bg-white')}>
      <Header text={route.params.app.name} />
      <FlatList
        data={contacts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // maxToRenderPerBatch={25}
        // updateCellsBatchingPeriod={100}
      />
      {!ALL_CONTACTS ? (
        <View>
          <View style={tailwind('h-5')} />
          <View style={tailwind('flex-row')}>
            <View style={tailwind('w-1/6')} />
            <TouchableNativeFeedback onPress={async () => await pickAndCall()}>
              <View style={tailwind('w-2/3 h-12 bg-custom-blue')}>
                <Text
                  style={tailwind('text-2xl font-bold text-white text-center')}>
                  {'More contacts'}
                </Text>
              </View>
            </TouchableNativeFeedback>
          </View>
          <View style={tailwind('h-5')} />
        </View>
      ) : null}
    </View>
  );
};

async function getAppData(): Promise<AppData | null> {
  if (appDataCache !== undefined) {
    return appDataCache;
  }
  try {
    const jsonVal = await AsyncStorage.getItem(APP_DATA_LABEL);
    if (jsonVal === null) {
      return null;
    }
    appDataCache = JSON.parse(jsonVal);
  } catch (err) {
    console.warn(err);
    alert('Unable to retrieve app configurations');
    return null;
  }

  console.log('Retrieved app configurations.');
  return appDataCache !== undefined ? appDataCache : null;
}

// async function getContactIdByName(name: string): Promise<string> {
//   const cnts = (await getContacts()).filter(cnt => {
//     const cntName = [cnt.givenName, cnt.familyName]
//       .join(' ')
//       .toLowerCase()
//       .trim();
//     return cntName === name.toLowerCase();
//   });
//   if (cnts.length > 0) {
//     return cnts[0].recordID;
//   }
//   throw new Error(`${cnts.length} contacts with this name were found: ${name}`);
// }

function openApp(pkg: string) {
  return async () => {
    if (await checkInstalled(pkg)) {
      await SendIntentAndroid.openApp(pkg, {});
    }
  };
}

const ConfigurePanel = ({navigation, route}: ConfigureProps) => {
  const tailwind = useTailwind();

  const [apps, setApps] = useState<App[]>([]);
  useEffect(() => {
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS, {
      title: 'Show Contacts',
      message: 'This app would like to show your contacts.',
      buttonNeutral: 'Ask Me Later',
      buttonNegative: 'Cancel',
      buttonPositive: 'OK',
    })
      .then(() =>
        Torch.requestCameraPermission(
          'Turn on Flashlight',
          "Camera permissions are required to use the phone's flashlight.",
        ),
      )
      .then(() => {
        PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          {
            title: 'Show Missed Calls',
            message: 'This app would like to show your call logs.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
      })
      .catch(console.warn);
    // Only run on first render
  }, []);

  useEffect(() => {
    const allApps = APPS.concat(EXTRA_APPS)
      .concat(BACKGROUND_APPS)
      .filter(app => app.package || app.depPackage);
    // Dynamically pick the correct vvm app
    pickVisualVoicemailApp()
      .then(vmPkg => {
        if (vmPkg) {
          const vmApp = {
            key: 'voicemail',
            name: 'Voicemail',
            icon: 'voicemail',
            color: COLORS.green,
            package: vmPkg,
          };
          allApps.push(vmApp);
        }
        Promise.all(
          allApps.map(
            async app =>
              !(await SendIntentAndroid.isAppInstalled(
                app.package ?? app.depPackage ?? '',
              )),
          ),
        )
          .then(results => setApps(allApps.filter((app, i) => results[i])))
          .catch(console.warn);
      })
      .catch(console.warn);
    // Only run on first render
  }, []);

  const {
    control,
    handleSubmit,
    formState: {errors},
  } = useForm<AppData>({
    defaultValues: route.params.defaults,
  });
  const [errTxt, setErrTxt] = useState<string>('');
  const refs: any[] = [];

  const processInput = (input: string) => {
    return input.replace(/\s+/g, ' ').trim();
  };

  const onSubmit = async (data: AppData) => {
    console.log(data);
    setErrTxt('');
    // data.emerContact1 = processInput(data.emerContact1);
    data.homepageUrl = processInput(data.homepageUrl);
    data.homeAddress = processInput(data.homeAddress);
    data.favMusicGenre = processInput(data.favMusicGenre);

    // TODO: Use contact picker
    // try {
    //   data.emerContact1 = await getContactIdByName(data.emerContact1);
    // } catch (err) {
    //   console.warn(err);
    //   setErrTxt('Invalid emergency contact, try again');
    //   return;
    // }

    let url: URL | undefined;
    try {
      url = new URL(data.homepageUrl);
    } catch (err) {
      try {
        url = new URL(`https://${data.homepageUrl}`);
      } catch (err2) {
        console.warn(err);
        setErrTxt('Invalid homepage url, try again');
        return;
      }
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      const msg = 'Homepage url must start with http or https';
      console.warn(`${msg}, url = ${data.homepageUrl}`);
      setErrTxt(`${msg}, try again`);
      return;
    }
    data.homepageUrl = url.href;

    try {
      const jsonVal = JSON.stringify(data);
      await AsyncStorage.setItem(APP_DATA_LABEL, jsonVal);
    } catch (err) {
      console.warn(err);
      setErrTxt('Submit failed, try again');
      return;
    }
    appDataCache = {...data};
    navigation.goBack();
  };

  const onSkip = async () => {
    setErrTxt('');
    try {
      const jsonVal = JSON.stringify(APP_DATA_DEFAULTS);
      await AsyncStorage.setItem(APP_DATA_LABEL, jsonVal);
    } catch (err) {
      console.warn(err);
      setErrTxt('Skip failed, try again');
      return;
    }
    appDataCache = {...APP_DATA_DEFAULTS};
    navigation.goBack();
  };

  const installApp = (pkg: string) => {
    return async () => {
      await Linking.openURL(PLAY_STORE_URL + pkg);
    };
  };

  const optionStyle = tailwind('p-1');
  const textStyle = tailwind('text-2xl font-bold text-black');
  const subTextStyle = tailwind('text-xl font-semibold text-black');
  const inputStyle = tailwind(
    'text-2xl font-bold text-black bg-white border border-indigo-200',
  );
  const errStyle = tailwind('text-xl font-bold text-red-600');
  return (
    <KeyboardAwareScrollView
      getTextInputRefs={() => {
        return refs;
      }}>
      <Header text={'Phone options'} />
      <View style={optionStyle}>
        <Button
          title="Phone Settings"
          onPress={openApp(SETTINGS)}
          color={COLORS.blue}
        />
      </View>
      {apps.length > 0 && (
        <View>
          <Header text={'Install & configure'} />
          <View style={tailwind('flex flex-row flex-wrap m-2')}>
            {apps.map(app => {
              return (
                <View style={tailwind('m-1')} key={app.key}>
                  <Button
                    key={app.key}
                    title={app.name}
                    onPress={installApp(app.package ?? app.depPackage ?? '')}
                    color={COLORS.orange}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}
      <Header text={'Customize'} />
      <Text style={subTextStyle}>Input to enable optional features:</Text>
      <View style={optionStyle}>
        <Text style={textStyle}>Home Address</Text>
        <Text style={subTextStyle}>
          The Maps and Taxi apps will auto-navigate to this address.
        </Text>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({field: {onChange, onBlur, value}}) => (
            <TextInput
              style={inputStyle}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="123 Main St, Small Town, CA 98765"
              value={value}
              ref={(r: any) => {
                refs.push(r);
              }}
            />
          )}
          name="homeAddress"
        />
        {errors.homeAddress && <Text style={errStyle}>This is required.</Text>}
      </View>
      {/* <View style={optionStyle}>
        <Text style={textStyle}>Emergency Contact</Text>
        <Text style={subTextStyle}>
          The Help! button will call and text this person.
        </Text>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({field: {onChange, onBlur, value}}) => (
            <TextInput
              style={inputStyle}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="First LastName"
              value={value}
            />
          )}
          name="emerContact1"
        />
        {errors.emerContact1 && <Text style={errStyle}>This is required.</Text>}
      </View> */}
      <View style={optionStyle}>
        <Text style={textStyle}>Homepage Url</Text>
        <Text style={subTextStyle}>
          The Internet app will open to this url.
        </Text>
        <Controller
          control={control}
          rules={{
            required: true,
          }}
          render={({field: {onChange, onBlur, value}}) => (
            <TextInput
              style={inputStyle}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="https://example.com"
              value={value}
            />
          )}
          name="homepageUrl"
        />
        {errors.homepageUrl && <Text style={errStyle}>This is required.</Text>}
      </View>
      <View style={optionStyle}>
        <Text style={textStyle}>Favorite Music Genre</Text>
        <Text style={subTextStyle}>
          The Music app will search for this genre.
        </Text>
        <Controller
          control={control}
          rules={{
            maxLength: 25,
          }}
          render={({field: {onChange, onBlur, value}}) => (
            <TextInput
              style={inputStyle}
              onBlur={onBlur}
              onChangeText={onChange}
              placeholder="slow jazz"
              value={value}
            />
          )}
          name="favMusicGenre"
        />
      </View>
      <Text style={errStyle}>{errTxt}</Text>
      <Button
        title="Submit"
        onPress={handleSubmit(onSubmit)}
        color={COLORS.green}
      />
      <View style={tailwind('h-5')} />
      <Button title="Skip for now" onPress={onSkip} color={COLORS.yellow} />
      <View style={tailwind('h-5')} />
    </KeyboardAwareScrollView>
  );
};

// async function sleep(sec: number) {
//   return new Promise(res => setTimeout(res, sec * 1000));
// }

// async function getEmergencyContacts(): Promise<Contacts.Contact[]> {
//   const data = await getAppData();
//   if (data === null || !data.emerContact1) {
//     return [];
//   }
//   const ids: string[] = [data.emerContact1];
//   return (await getContacts()).filter(cnt => ids.includes(cnt.recordID));
// }

// export async function helpCallsAndTexts() {
//   const emerContacts = await getEmergencyContacts();
//   if (emerContacts.length === 0) {
//     console.warn('No emergency contacts have been added.');
//     Alert.alert(
//       'No emergency contacts have been added. Call 911 if necessary!',
//     );
//     return;
//   }

//   for (const contact of emerContacts) {
//     const phoneNum = removeNonDigits(contact.phoneNumbers[0].number);
//     console.log(`Texting ${phoneNum}`);
//     SendSMS.send(
//       {
//         body: 'I have pressed the help button on my phone! Please call ASAP!',
//         recipients: [phoneNum],
//         // @ts-ignore
//         successTypes: ['all'],
//         allowAndroidSendWithoutReadPermission: true,
//       },
//       (completed, cancelled, error) => {
//         console.log(
//           `SMS: completed: ${completed}, cancelled: ${cancelled}, error: ${error}`,
//         );
//         // TODO: callback only fires after you have navigated back
//         SendIntentAndroid.openApp('com.greyphone', {})
//           .then(_ => {
//             console.log(`Calling ${phoneNum}`);
//             callPhone(phoneNum);
//           })
//           .catch(console.warn);
//       },
//     );

//     const callDetector = new CallDetectorManager(
//       (event: string, phoneNumber: string) => {
//         console.log(`Call state: ${event}, phone: ${phoneNumber}`);
//         // Ignore iOS call states
//         if (event === 'Disconnected') {
//           // qqq
//         } else if (event === 'Incoming') {
//           // qqq
//         } else if (event === 'Offhook') {
//           // At least one call exists that is dialing, active, or on hold,
//           // and no calls are ringing or waiting.
//           // qqq
//         } else if (event === 'Missed') {
//           // qqq
//         }
//       },
//       false,
//     );

//     await sleep(60);
//     callDetector.dispose();
//   }
// }

async function checkInstalled(pkg: string): Promise<boolean> {
  if (await SendIntentAndroid.isAppInstalled(pkg)) {
    return true;
  }
  console.warn(`Pkg not installed: ${pkg}`);
  await Linking.openURL(PLAY_STORE_URL + pkg);
  return false;
}

function getExport(varName: string): any {
  if (!(varName in module.exports)) {
    throw new Error(`${varName} was never exported`);
  }
  return module.exports[varName];
}

async function getAppDataOrDefault(): Promise<AppData> {
  const data = (await getAppData()) ?? APP_DATA_DEFAULTS;
  // const emer = (await getContacts()).find(
  //   cnt => cnt.recordID === data.emerContact1,
  // );
  // data.emerContact1 = emer ? `${emer.givenName} ${emer.familyName}` : '';
  return data;
}

async function handleApp(app: App, navigation: NavProp) {
  console.log(app.name);
  if (app.package) {
    app.depPackage = app.package;
  }
  try {
    if (app.depPackage && !(await checkInstalled(app.depPackage))) {
      return;
    }
  } catch (err) {
    console.warn(err);
    alert(`Unable to install package: ${app.depPackage}`);
  }
  if (!app.cbParams) {
    app.cbParams = [];
  }

  if (app.screen) {
    switch (app.screen) {
      case Screen.ContactList:
      case Screen.CallLogList:
        navigation.navigate(app.screen, {app: app});
        break;
      case Screen.Configure:
        navigation.navigate(app.screen, {
          defaults: await getAppDataOrDefault(),
        });
        break;
      default:
        alertAndWarn(`Unknown / disabled screen: ${app.screen}`);
    }
  } else if (app.url) {
    try {
      if (await Linking.canOpenURL(app.url)) {
        // Open the link with an app. If the URL scheme is "http" the link
        // will be opened by the default browser.
        await Linking.openURL(app.url);
      } else {
        alertAndWarn(`Unknown URL: ${app.url}`);
      }
    } catch (err) {
      console.warn(err);
      alert(`Bad URL: ${app.url}`);
    }
  } else if (app.package) {
    try {
      await SendIntentAndroid.openApp(app.package, {});
    } catch (err) {
      console.warn(err);
      alert(`Bad pkg: ${app.package}`);
    }
  } else if (app.callback) {
    try {
      getExport(app.callback)(...app.cbParams);
    } catch (err) {
      console.warn(err);
      alert(`Bad app callback: ${app.name}`);
    }
  } else if (app.asyncCallback) {
    try {
      await getExport(app.asyncCallback)(...app.cbParams);
    } catch (err) {
      console.warn(err);
      alert(`Bad app callback: ${app.name}`);
    }
  } else {
    console.warn(JSON.stringify(app));
    alert(`Invalid app: ${app.name}`);
  }
}

const AppOption = (props: {app: App; navigation: NavProp}) => {
  const tailwind = useTailwind();

  return (
    <View style={tailwind('flex w-1/3')}>
      <TouchableNativeFeedback
        key={props.app.key}
        onPress={async () => await handleApp(props.app, props.navigation)}>
        <View
          style={tailwind(
            'rounded-md m-1 items-center border border-indigo-600 bg-white',
          )}>
          <Icon name={props.app.icon} size={90} color={props.app.color} />
          <Text style={tailwind('text-xl text-center font-bold text-black')}>
            {props.app.name}
          </Text>
        </View>
      </TouchableNativeFeedback>
    </View>
  );
};

function getDateTime() {
  // Format by hand to avoid 6MB Intl library.
  // def jscFlavor = 'org.webkit:android-jsc-intl:+' // build.gradle
  // return new Date().toLocaleString('en', {
  //   timeStyle: 'short',
  //   dateStyle: 'medium',
  //   hour12: true,
  // });

  const now = new Date();
  let hrs = now.getHours() % 12;
  if (hrs === 0) {
    hrs = 12;
  }
  const meridiem = now.getHours() < 12 ? 'AM' : 'PM';
  let min = `${now.getMinutes()}`;
  if (min.length === 1) {
    min = `0${min}`;
  }

  return `${WEEKDAYS[now.getDay()]} ${
    MONTHS[now.getMonth()]
  } ${now.getDate()}, ${now.getFullYear()}\n${hrs}:${min} ${meridiem}`;
}

const Battery = () => {
  const tailwind = useTailwind();
  const [level, setLevel] = useState(1.0);
  const [props, setProps] = useState(BATTERY_PROPS.full);
  useEffect(() => {
    const updateBatteryStatus = () => {
      DeviceInfo.getPowerState()
        .then(power => {
          //   batteryLevel: 0.759999,
          //   batteryState: unplugged, charging, full, unknown
          //   lowPowerMode: false,
          if (!power.batteryLevel) {
            return;
          }
          if (
            power.batteryState === 'unplugged' &&
            level >= LOW_BATTERY &&
            power.batteryLevel < LOW_BATTERY
          ) {
            const lvl = Math.round(power.batteryLevel * 100);
            Alert.alert(`Warning, battery is low (${lvl}%). Please charge!`);
          }

          setLevel(power.batteryLevel);
          if (power.batteryState === 'charging') {
            setProps(BATTERY_PROPS.charging);
          } else if (power.batteryLevel >= BATTERY_PROPS.full.minLevel) {
            setProps(BATTERY_PROPS.full);
          } else if (power.batteryLevel >= BATTERY_PROPS.medium.minLevel) {
            setProps(BATTERY_PROPS.medium);
          } else {
            setProps(BATTERY_PROPS.low);
          }
        })
        .catch(console.warn);
    };

    updateBatteryStatus();
    let checkTimer = setInterval(updateBatteryStatus, 5 * 1000);
    return () => clearInterval(checkTimer);
    // Only run on first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={tailwind('flex flex-row')}>
      <Icon
        name={props.icon}
        size={60}
        color={props.color}
        style={tailwind('rotate270')}
      />
      <Text style={tailwind('text-2xl font-bold text-black')}>
        {`${Math.round(level * 100)}%`}
      </Text>
    </View>
  );
};

// https://stackoverflow.com/q/41294576
const Clock = () => {
  const [dt, setDt] = useState(getDateTime());
  useEffect(() => {
    let secTimer = setInterval(() => {
      setDt(getDateTime());
    }, 5 * 1000);

    return () => clearInterval(secTimer);
    // Only run on first render
  }, []);

  return <Header text={dt} />;
};

const AppPanel = ({navigation, route}: HomeProps | ExtrasProps) => {
  const tailwind = useTailwind();

  useEffect(() => {
    if (route.name !== Screen.Home) {
      return;
    }
    getAppData()
      .then(data => {
        // Only load the configure screen once in app lifetime.
        if (data === null) {
          navigation.navigate(Screen.Configure, {defaults: APP_DATA_DEFAULTS});
        }
      })
      .catch(console.warn);
    // Only run on first render, deps shouldn't change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={tailwind('grow')}>
      <Clock />
      <View style={tailwind('flex flex-row flex-wrap')}>
        {route.params.apps.map(app => {
          return <AppOption key={app.key} app={app} navigation={navigation} />;
        })}
      </View>
      <View style={tailwind('absolute bottom-0 left-0')}>
        <Battery />
      </View>
      <View style={tailwind('absolute bottom-0 right-0')}>
        <Button
          title="Original Home Screen"
          color={COLORS.grey}
          onPress={openApp(LAUNCHER)}
        />
      </View>
    </View>
  );
};

function HomeTabScreen() {
  const tailwind = useTailwind();

  return (
    <HomeTab.Navigator
      initialRouteName={Screen.Home}
      screenOptions={{
        tabBarShowLabel: false,
        tabBarStyle: tailwind('h-2'),
        tabBarIndicatorStyle: tailwind('h-2'),
        // tabBarLabelStyle: tailwind('text-lg font-semibold text-black'),
      }}>
      <HomeTab.Screen
        name={Screen.Home}
        // @ts-ignore
        component={AppPanel}
        initialParams={{apps: APPS}}
        options={{tabBarLabel: 'Home'}}
      />
      <HomeTab.Screen
        name={Screen.Extras}
        // @ts-ignore
        component={AppPanel}
        initialParams={{apps: EXTRA_APPS}}
        options={{tabBarLabel: 'Extra'}}
      />
    </HomeTab.Navigator>
  );
}

const App = () => {
  useEffect(() => {
    // Turn off flashlight if it's on
    turnTorchOff().catch(console.log);
    // Only run on first render
  }, []);

  return (
    <TailwindProvider utilities={utilities}>
      <NavigationContainer>
        <RootStack.Navigator
          initialRouteName={Screen.Home}
          screenOptions={{
            headerShown: false,
          }}>
          <RootStack.Screen name={Screen.HomeTab} component={HomeTabScreen} />
          <RootStack.Screen
            name={Screen.ContactList}
            component={ContactPanel}
            initialParams={{app: APPS[0]}}
          />
          <RootStack.Screen
            name={Screen.CallLogList}
            component={CallLogPanel}
            initialParams={{app: APPS[0]}}
          />
          <RootStack.Screen
            name={Screen.Configure}
            component={ConfigurePanel}
            initialParams={{defaults: APP_DATA_DEFAULTS}}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </TailwindProvider>
  );
};

export default App;
