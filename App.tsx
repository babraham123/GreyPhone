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
import CallLogs from 'react-native-call-log';
import RNImmediatePhoneCall from 'react-native-immediate-phone-call';
import Torch from 'react-native-torch';
import {useForm, Controller} from 'react-hook-form';
import SmsAndroid from 'react-native-sms-android';
import {selectContactPhone} from 'react-native-select-contact';
import {KeyboardAwareScrollView} from 'react-native-keyboard-aware-scrollview';
import DeviceInfo from 'react-native-device-info';

const DEBUG = true;

LogBox.ignoreLogs(['new NativeEventEmitter']);
LogBox.ignoreAllLogs();

const PLAY_STORE_URL = 'market://launch?id=';
const UBER_URL_ROOT =
  'uber://?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=';
const LAUNCHER = 'shubh.ruthless'; // 'com.google.android.apps.nexuslauncher'
const SETTINGS = 'com.android.settings';
const MAGNIFIER = 'com.app2u.magnifier';

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
const LOW_BATTERY = 0.15;
const CALLS_LOOKBACK_MS = 1000 * 60 * 60 * 24 * 30; // 1 month

export enum Screen {
  Home = 'Home',
  Extras = 'Extras',
  ContactList = 'ContactList',
  Configure = 'Configure',
  HomeTab = 'HomeTab',
}
type StackParamList = {
  Home: {apps: App[]};
  Extras: {apps: App[]};
  ContactList: {app: App};
  Configure: {defaults: AppData};
  HomeTab: undefined;
};

const RootStack = createNativeStackNavigator<StackParamList>();
const HomeTab = createMaterialTopTabNavigator();

type HomeProps = NativeStackScreenProps<StackParamList, Screen.Home>;
type ExtrasProps = NativeStackScreenProps<StackParamList, Screen.Extras>;
type ContactsProps = NativeStackScreenProps<StackParamList, Screen.ContactList>;
type ConfigureProps = NativeStackScreenProps<StackParamList, Screen.Configure>;
type HomeTabProps = NativeStackScreenProps<StackParamList, Screen.HomeTab>;
type NavProp =
  | HomeProps['navigation']
  | ExtrasProps['navigation']
  | ContactsProps['navigation']
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
  emerContact1: string;
}
const APP_DATA_DEFAULTS = {
  homeAddress: '',
  favMusicGenre: '',
  emerContact1: '',
};
let appDataCache: AppData | undefined;

interface App {
  key: string;
  name: string;
  icon: string;
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
    key: 'dial',
    name: 'Dialpad',
    icon: 'dialpad',
    url: 'tel:',
  },
  {
    key: 'phone',
    name: 'Phone',
    icon: 'phone',
    callback: 'callPhone',
    cbParams: [],
    screen: Screen.ContactList,
  },
  {
    key: 'texts',
    name: 'Text Msgs',
    icon: 'chat',
    package: 'com.google.android.apps.messaging',
  },
  {
    key: 'voicemail',
    name: 'Voicemail',
    icon: 'voicemail',
    asyncCallback: 'openVoicemail',
  },
  {
    key: 'missed',
    name: 'Missed Calls',
    icon: 'phone-missed',
    url: 'content://call_log/calls', // TODO: fix
    depPackage: 'com.goodwy.dialer', // 'com.google.android.dialer',
  },
  {
    key: 'camera',
    name: 'Camera',
    icon: 'photo-camera',
    callback: 'openCamera',
  },
  {
    key: 'photos',
    name: 'Photos',
    icon: 'photo',
    package: 'com.google.android.apps.photos',
  },
  {
    key: 'maps',
    name: 'Map Home',
    icon: 'map',
    asyncCallback: 'mapHome',
    // url: `geo:${HOME_GPS.lat},${HOME_GPS.lon}`,
    depPackage: 'com.google.android.apps.maps',
  },
  {
    key: 'reminder',
    name: 'Reminders',
    icon: 'alarm',
    package: 'in.smsoft.justremind', // 'com.google.android.deskclock'
  },
  {
    key: 'weather',
    name: 'Weather',
    icon: 'wb-sunny',
    url: 'dynact://velour/weather/ProxyActivity',
  },
  {
    key: 'emergency',
    name: 'Call for Help',
    icon: 'new-releases',
    asyncCallback: 'helpCallsAndTexts',
  },
  {
    key: 'magnifier',
    name: 'Magnifier & Flashlight',
    icon: 'saved-search',
    asyncCallback: 'turnTorchOnAndMagnify',
  },
];

const EXTRA_APPS: App[] = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    icon: 'add-ic-call',
    url: 'whatsapp://send?phone=', // 'https://wa.me/',
    depPackage: 'com.whatsapp',
    screen: Screen.ContactList,
  },
  {
    key: 'uber',
    name: 'Taxi Home',
    icon: 'local-taxi',
    asyncCallback: 'uberHome',
    depPackage: 'com.ubercab',
  },
  {
    key: 'music',
    name: 'Music',
    icon: 'headset',
    asyncCallback: 'openSpotify',
    depPackage: 'com.spotify.music',
  },
  {
    key: 'calendar',
    name: 'Calendar',
    icon: 'calendar-today',
    package: 'com.google.android.calendar',
  },
  {
    key: 'email',
    name: 'Email',
    icon: 'email',
    package: 'com.google.android.gm',
  },
  {
    key: 'calculator',
    name: 'Calculator',
    icon: 'calculate',
    package: 'com.google.android.calculator',
  },
  {
    key: 'health',
    name: 'Health',
    icon: 'directions-run',
    package: 'com.google.android.apps.fitness',
  },
  {
    key: 'solitaire',
    name: 'Solitaire',
    icon: 'auto-awesome-motion',
    package: 'com.potatojam.classic.solitaire.klondike',
  },
  {
    key: 'fortune',
    name: 'Wheel of Fortune',
    icon: 'filter-tilt-shift',
    package: 'com.scopely.wheeloffortune',
  },
  {
    key: 'news',
    name: 'News',
    icon: 'radio',
    package: 'org.npr.one',
  },
  {
    key: 'settings',
    name: 'Settings',
    icon: 'settings',
    screen: Screen.Configure,
  },
  {
    key: 'book',
    name: 'Books',
    icon: 'menu-book',
    package: 'com.google.android.apps.books',
  },
];

const BACKGROUND_APPS: App[] = [
  {
    key: 'launcher',
    name: 'Default Launcher',
    icon: 'apps',
    package: LAUNCHER,
  },
  {
    key: 'settings',
    name: 'Settings',
    icon: 'settings',
    package: SETTINGS,
  },
  {
    key: 'locator',
    name: 'Find My Device',
    icon: 'location-searching',
    package: 'com.google.android.apps.adm',
  },
  {
    key: 'magnifier',
    name: 'Magnifier & Flashlight',
    icon: 'search',
    package: MAGNIFIER,
  },
];

export function openCamera() {
  SendIntentAndroid.openCamera();
}

export async function mapHome() {
  const data = await getAppData();
  if (data === null) {
    alertAndWarn('Home address is not set.');
    SendIntentAndroid.openMaps('');
  } else {
    SendIntentAndroid.openMapsWithRoute(data.homeAddress, 'd');
  }
}

export async function uberHome() {
  const data = await getAppData();
  if (data === null || data.homeAddress === '') {
    alertAndWarn('Home address is not set.');
    await Linking.openURL('uber://');
  } else {
    await Linking.openURL(UBER_URL_ROOT + encodeURIComponent(data.homeAddress));
  }
}

export async function openSpotify() {
  const data = await getAppData();
  if (data === null || data.favMusicGenre === '') {
    await Linking.openURL('spotify://');
  } else {
    await Linking.openURL(
      `spotify://search/${encodeURIComponent(data.favMusicGenre)}/playlists`,
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
  await SendIntentAndroid.openApp(MAGNIFIER, {});
}

async function turnTorchOff() {
  try {
    const isTorchOn = await Torch.getStatus();
    if (isTorchOn) {
      await Torch.switchState(true);
    }
  } catch (e) {}
}

export async function openVoicemail() {
  const vmPkg = await pickVisualVoicemailApp();
  if (vmPkg) {
    if (await checkInstalled(vmPkg)) {
      await SendIntentAndroid.openApp(vmPkg, {});
    }
    return;
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
  const num = selectedPhone.number.replace(/[^0-9]/g, '');
  RNImmediatePhoneCall.immediatePhoneCall(num);
}

export function callPhone(phoneNum: string) {
  const num = phoneNum.replace(/[^0-9]/g, '');
  RNImmediatePhoneCall.immediatePhoneCall(num);
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

async function getMissedCalls(): Promise<CallLogs.CallLog[]> {
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
    return await CallLogs.load(100, {minTimestamp: cutOffDate});
  } catch (err) {
    console.warn(err);
    alert('Unable to retrieve call logs');
  }
  return [];
}

const CallLog = (props: {
  contact: Contacts.Contact;
  app: App;
  navigation: NavProp;
}) => {
  const tailwind = useTailwind();
  // deep copy
  const app = JSON.parse(JSON.stringify(props.app));
  app.screen = undefined;
  const tel = props.contact.phoneNumbers[0].number.replace(/[^0-9]/g, '');
  if (app.url) {
    app.url = app.url + tel;
  }
  if (app.cbParams !== undefined) {
    app.cbParams.push(tel);
  }
  app.name = `${props.contact.givenName} ${props.contact.familyName}${
    props.contact.isStarred ? '    ⭐' : ''
  }`;
  // app.key = `${app.key}-${props.contact.givenName}-${props.contact.familyName}`;
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
            <Icon name={app.icon} size={40} color="#900" />
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

const CallLogPanel = ({navigation, route}: ContactsProps) => {
  const tailwind = useTailwind();

  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  useEffect(() => {
    getContacts()
      .then(cnts => {
        setContacts(
          cnts.filter(
            cnt =>
              cnt.phoneNumbers.length > 0 &&
              cnt.phoneNumbers[0].number &&
              cnt.givenName.length > 0 &&
              !['#', '*'].includes(cnt.givenName.charAt(0)),
          ),
        );
      })
      .catch(console.warn);
  }, [contacts]);

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
    <View style={tailwind('flex-1 bg-white')}>
      <Header text={route.params.app.name} />
      <FlatList
        data={contacts}
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
  } else if (phoneInfo.manufacturer === 'samsung') {
    return 'com.samsung.vvm';
  }

  // https://source.android.com/devices/tech/config/carrierid
  // https://android.googlesource.com/platform/packages/providers/TelephonyProvider/+/master/assets/latest_carrier_id/carrier_list.textpb
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
  app.screen = undefined;
  const tel = props.contact.phoneNumbers[0].number.replace(/[^0-9]/g, '');
  if (app.url) {
    app.url = app.url + tel;
  }
  if (app.cbParams !== undefined) {
    app.cbParams.push(tel);
  }
  app.name = `${props.contact.givenName} ${props.contact.familyName}${
    props.contact.isStarred ? '    ⭐' : ''
  }`;
  // app.key = `${app.key}-${props.contact.givenName}-${props.contact.familyName}`;
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
            <Icon name={app.icon} size={40} color="#900" />
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
              cnt.phoneNumbers.length > 0 &&
              cnt.phoneNumbers[0].number &&
              cnt.givenName.length > 0 &&
              !['#', '*'].includes(cnt.givenName.charAt(0)),
          ),
        );
      })
      .catch(console.warn);
  }, [contacts]);

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
    <View style={tailwind('flex-1 bg-white')}>
      <Header text={route.params.app.name} />
      <FlatList
        data={contacts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        maxToRenderPerBatch={25}
        updateCellsBatchingPeriod={100}
      />
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

async function getContactIdByName(name: string): Promise<string> {
  const parts = name.split(' ');
  if (parts.length < 1) {
    throw new Error('Invalid first name');
  }
  let cnts = (await getContacts()).filter(cnt => cnt.givenName === parts[0]);
  if (cnts.length === 1) {
    return cnts[0].recordID;
  }

  if (parts.length < 2) {
    throw new Error('Last name needed for filtering');
  }
  cnts = (await getContacts()).filter(cnt => cnt.familyName === parts[1]);
  if (cnts.length === 1) {
    return cnts[0].recordID;
  }
  throw new Error(`${cnts.length} contacts with this name were found: ${name}`);
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
  }, [apps]);

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
    return input.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  };

  const onSubmit = async (data: AppData) => {
    console.log(data);
    setErrTxt('');
    data.emerContact1 = processInput(data.emerContact1);
    data.homeAddress = processInput(data.homeAddress);
    data.favMusicGenre = processInput(data.favMusicGenre);

    try {
      data.emerContact1 = await getContactIdByName(data.emerContact1);
    } catch (err) {
      console.warn(err);
      setErrTxt('Invalid emergency contact, try again');
      return;
    }

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

  const openApp = (pkg: string) => {
    return async () => {
      await SendIntentAndroid.openApp(pkg, {});
    };
  };

  const installApp = (pkg: string) => {
    return async () => {
      await Linking.openURL(PLAY_STORE_URL + pkg);
    };
  };

  const optionStyle = tailwind('p-1');
  const textStyle = tailwind('text-2xl font-bold text-black');
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
        <Button title="Phone Settings" onPress={openApp(SETTINGS)} />
      </View>
      <View style={optionStyle}>
        <Button title="Default Launcher" onPress={openApp(LAUNCHER)} />
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
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}
      <Header text={'Customize'} />
      <View style={optionStyle}>
        <Text style={textStyle}>Home Address</Text>
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
      <View style={optionStyle}>
        <Text style={textStyle}>Emergency Contact</Text>
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
      </View>
      <View style={optionStyle}>
        <Text style={textStyle}>Favorite Music Genre</Text>
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
      <Button title="Submit" onPress={handleSubmit(onSubmit)} />
      <View style={tailwind('h-5')} />
    </KeyboardAwareScrollView>
  );
};

// async function wait(sec: number) {
//   return new Promise(res => setTimeout(res, sec * 1000));
// }

async function getEmergencyContacts(): Promise<Contacts.Contact[]> {
  const data = await getAppData();
  if (data === null) {
    return [];
  }
  const ids: string[] = [data.emerContact1];
  return (await getContacts()).filter(cnt => ids.includes(cnt.recordID));
}

export async function helpCallsAndTexts() {
  const emerContacts = await getEmergencyContacts();
  if (emerContacts.length === 0) {
    alertAndWarn('No emergency contacts have been added.');
    return;
  }

  for (const contact of emerContacts) {
    SmsAndroid.sms(
      contact.phoneNumbers[0].number.replace(/[^0-9]/g, ''),
      'I have pressed the help button on my phone! Please call ASAP!',
      'sendDirect',
      (err: Error, msg: string) => {
        if (err) {
          console.warn(err);
          alert('Failed to send help text msg');
        } else {
          console.log(msg);
        }
      },
    );

    // const callDetector = new CallDetectorManager(
    //   (event: string, phoneNumber: string) => {
    //     console.log(`Call state: ${event}, phone: ${phoneNumber}`);
    //     // Ignore iOS call states
    //     if (event === 'Disconnected') {
    //       // qqq
    //     } else if (event === 'Incoming') {
    //       // qqq
    //     } else if (event === 'Offhook') {
    //       // At least one call exists that is dialing, active, or on hold,
    //       // and no calls are ringing or waiting.
    //       // qqq
    //     } else if (event === 'Missed') {
    //       // qqq
    //     }
    //   },
    //   true,
    // );

    callPhone(contact.phoneNumbers[0].number);
    console.log(`Called: ${contact.phoneNumbers[0].number}`);
    // await wait(60);
    // callDetector.dispose();
  }
}

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
  const emer = (await getContacts()).find(
    cnt => cnt.recordID === data.emerContact1,
  );
  data.emerContact1 = emer ? `${emer.givenName} ${emer.familyName}` : '';
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
          <Icon name={props.app.icon} size={90} color="#465c80" />
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

  return `${WEEKDAYS[now.getDay()]} ${
    MONTHS[now.getMonth()]
  } ${now.getDate()}, ${now.getFullYear()}\n${hrs}:${now.getMinutes()} ${meridiem}`;
}

// https://stackoverflow.com/q/41294576
const Clock = () => {
  const [dt, setDt] = useState(getDateTime());
  useEffect(() => {
    let secTimer = setInterval(() => {
      setDt(getDateTime());
    }, 5000);

    return () => clearInterval(secTimer);
  }, [dt]);

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
  }, [navigation, route]);

  return (
    <View>
      <Clock />
      <View style={tailwind('flex flex-row flex-wrap')}>
        {route.params.apps.map(app => {
          return <AppOption key={app.key} app={app} navigation={navigation} />;
        })}
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
        component={AppPanel}
        initialParams={{apps: APPS}}
        options={{tabBarLabel: 'Home'}}
      />
      <HomeTab.Screen
        name={Screen.Extras}
        component={AppPanel}
        initialParams={{apps: EXTRA_APPS}}
        options={{tabBarLabel: 'Extra'}}
      />
    </HomeTab.Navigator>
  );
}

const App = () => {
  useEffect(() => {
    DeviceInfo.getPowerState()
      .then(power => {
        // {
        //   batteryLevel: 0.759999,
        //   batteryState: 'unplugged',
        //   lowPowerMode: false,
        // }
        if (
          power.batteryState === 'unplugged' &&
          power.batteryLevel &&
          power.batteryLevel < LOW_BATTERY
        ) {
          const msg =
            power.batteryLevel >= power.batteryLevel / 2
              ? 'Please charge phone.'
              : 'Charge phone immediately!';
          const lvl = Math.round(power.batteryLevel * 100);
          Alert.alert(`Warning, battery is low (${lvl}%). ${msg}`);
        }
      })
      .catch(console.warn);
  }, []);

  useEffect(() => {
    // Turn off flashlight if it's on
    turnTorchOff().catch(console.log);
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
