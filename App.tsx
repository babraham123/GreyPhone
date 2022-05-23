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
  KeyboardAvoidingView,
  Linking,
  // Modal,
  PermissionsAndroid,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {TailwindProvider, useTailwind} from 'tailwind-rn';
import utilities from './tailwind.json';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Contacts from 'react-native-contacts';
import {NavigationContainer} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import SendIntentAndroid from 'react-native-send-intent';
import CallDetectorManager from 'react-native-call-detection';
import RNImmediatePhoneCall from 'react-native-immediate-phone-call';
import Torch from 'react-native-torch';
import {useForm, Controller} from 'react-hook-form';
// import {createStore} from 'state-pool';
import SmsAndroid from 'react-native-sms-android';
import {selectContactPhone} from 'react-native-select-contact';
import BatteryMonitor from 'react-native-battery-monitor';
import CallLogs from 'react-native-call-log'

const PLAY_STORE_URL = 'market://launch?id=';
const UBER_URL_ROOT =
  'uber://?action=setPickup&pickup=my_location&dropoff%5Bformatted_address%5D=';
const LAUNCHER = 'shubh.ruthless'; // 'com.google.android.apps.nexuslauncher'
const SETTINGS = 'com.android.settings';

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

const BATTERY_LEVELS = [0.2, 0.1, 0.05, 0.03, 0.02, 0.01];

// const globalStore = createStore(); // Synchronize global state
// globalStore.setState('modalVisible', false);
// globalStore.setState('modalText', '');

export enum Screen {
  Home = 'Home',
  Extras = 'Extras',
  ContactList = 'ContactList',
  Configure = 'Configure',
}

type RootStackParamList = {
  Home: {apps: App[]};
  Extras: {apps: App[]};
  ContactList: {app: App};
  Configure: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
type HomeProps = NativeStackScreenProps<RootStackParamList, Screen.Home>;
type ExtrasProps = NativeStackScreenProps<RootStackParamList, Screen.Extras>;
type ContactsProps = NativeStackScreenProps<
  RootStackParamList,
  Screen.ContactList
>;
type ConfigureProps = NativeStackScreenProps<
  RootStackParamList,
  Screen.Configure
>;
type NavProp =
  | HomeProps['navigation']
  | ExtrasProps['navigation']
  | ContactsProps['navigation']
  | ConfigureProps['navigation'];

let contactsCache: Contacts.Contact[] | undefined;

const APP_DATA_LABEL = '@AppData';
interface AppData {
  homeAddress: string;
  favMusicGenre: string;
  emerContact1: string;
}
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
    name: 'Phone Calls',
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
    key: 'missed',
    name: 'Missed Calls',
    icon: 'phone-missed',
    url: 'content://call_log/calls', // TODO: CallLog.Calls.CONTENT_TYPE
    depPackage: 'com.goodwy.dialer', // 'com.google.android.dialer',
  },
  {
    key: 'weather',
    name: 'Weather',
    icon: 'wb-sunny',
    url: 'dynact://velour/weather/ProxyActivity',
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
    key: 'flashlight',
    name: 'Flashlight',
    icon: 'lightbulb',
    asyncCallback: 'toggleTorch',
  },
  {
    key: 'emergency',
    name: 'Emergency',
    icon: 'new-releases',
    asyncCallback: 'emergencyCalls',
  },
  {
    key: 'more',
    name: 'More Apps',
    icon: 'more-horiz',
    screen: Screen.Extras,
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
    icon: 'search',
    package: 'com.google.android.apps.adm',
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

export async function toggleTorch() {
  const cameraAllowed = await Torch.requestCameraPermission(
    'Camera Permissions',
    "Camera permissions are required to use the phone's flashlight.",
  );
  if (!cameraAllowed) {
    return;
  }
  const isTorchOn = await Torch.getStatus();
  await Torch.switchState(!isTorchOn);

  // const [modalVisible, setModalVisible] = globalStore.useState('modalVisible');
  // const [, setModalText] = globalStore.useState('modalText');
  // setModalText(`Flashlight is ${!isTorchOn ? 'ON' : 'OFF'}!`);
  // setModalVisible(!modalVisible);

  Alert.alert(`Flashlight is ${!isTorchOn ? 'ON' : 'OFF'}!`);
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

function alertAndWarn(msg: string) {
  console.warn(msg);
  Alert.alert(msg);
}

const Header = (props: {text: string}) => {
  const tailwind = useTailwind();
  tailwind('h-20 h-12'); // Pre-compile for the ternary
  const height = props.text.length > 15 ? 20 : 12;

  return (
    <View style={tailwind(`flex flex-none w-full h-${height} bg-indigo-100`)}>
      <Text style={tailwind('text-4xl font-bold text-black text-center')}>
        {props.text}
      </Text>
    </View>
  );
};

async function getCallLogs(): Promise<CallLogs.CallLog[]> {
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    {
      title: 'Call Log',
      message: 'This app would like to access your call logs',
      buttonPositive: 'OK',
    },
  );
  if (granted === PermissionsAndroid.RESULTS.GRANTED) {
    const minTimestamp = Date.now() - 1000 * 60 * 60 * 24 * 30; // Only look back 1 month
    return await CallLogs.load(100, {minTimestamp});
  } else {
    console.warn('Call Log permission denied');
  }
  return [];
}

async function callVoicemail() {
  const vmNum = await SendIntentAndroid.getVoiceMailNumber();
  callPhone(vmNum);
}

async function getContacts(): Promise<Contacts.Contact[]> {
  if (contactsCache !== undefined) {
    return contactsCache;
  }
  try {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      {
        title: 'Contacts',
        message: 'This app would like to view your contacts.',
        buttonPositive: 'Please accept',
      },
    );

    contactsCache = await Contacts.getAllWithoutPhotos();
    contactsCache.sort((a, b) => {
      if (a.isStarred && !b.isStarred) {
        return -1;
      } else if (!a.isStarred && b.isStarred) {
        return 1;
      } else {
        return a.givenName > b.givenName ? 1 : -1;
      }
    });
  } catch (err) {
    console.warn(err);
    Alert.alert('Unable to retrieve contacts');
    contactsCache = [];
  }
  console.log(`${contactsCache.length} contacts retrieved.`);
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
  app.name = `${props.contact.givenName} ${props.contact.familyName}`;
  app.key = `${app.key}-${props.contact.givenName}-${props.contact.familyName}`;
  app.icon = 'person';

  return (
    <View
      style={tailwind(
        'flex w-full items-center rounded-xl m-1 border border-indigo-600 bg-white',
      )}>
      <TouchableOpacity
        key={app.key}
        onPress={async () => await handleApp(app, props.navigation)}>
        <View style={tailwind('flex-row')}>
          <View style={tailwind('w-1/5')}>
            <Icon name={app.icon} size={40} color="#900" />
          </View>
          <View style={tailwind('w-4/5')}>
            <Text style={tailwind('text-2xl text-center font-bold text-black')}>
              {app.name}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const ContactPanel = ({navigation, route}: ContactsProps) => {
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
  const [contacts, setContacts] = useState<Contacts.Contact[]>([]);
  useEffect(() => {
    getContacts()
      .then(cnts => {
        setContacts(
          cnts.filter(
            cnt =>
              cnt.phoneNumbers.length > 0 &&
              cnt.phoneNumbers[0].number &&
              !['#', '*'].includes(cnt.givenName.charAt(0)),
          ),
        );
      })
      .catch(console.warn);
  }, []);

  return (
    <View>
      <Header text={route.params.app.name} />
      <FlatList
        data={contacts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
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
    Alert.alert('Unable to retrieve app configurations');
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

const ConfigurePanel = ({navigation}: ConfigureProps) => {
  const tailwind = useTailwind();
  const optionStyle = tailwind('p-2');
  const textStyle = tailwind('text-2xl font-bold text-black');
  const inputStyle = tailwind(
    'text-2xl font-bold text-black bg-white border border-indigo-200',
  );

  const [apps, setApps] = useState<App[]>([]);
  useEffect(() => {
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS, {
      title: 'Contacts',
      message: 'This app would like to view your contacts.',
      buttonPositive: 'OK',
    })
      .then(() =>
        Torch.requestCameraPermission(
          'Camera Permissions',
          "Camera permissions are required to use the phone's flashlight.",
        ),
      )
      .then(() => {
        PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          {
            title: 'Call Log',
            message: 'This app would like to access your call logs',
            buttonPositive: 'OK',
          },
        );
      })
      .catch(console.warn);

    const allApps = APPS.concat(EXTRA_APPS)
      .concat(BACKGROUND_APPS)
      .filter(app => app.package || app.depPackage);
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
  });

  const {
    control,
    handleSubmit,
    formState: {errors},
  } = useForm<AppData>({
    defaultValues: {
      homeAddress: '',
      favMusicGenre: '',
      emerContact1: '',
    },
  });
  const [errTxt, setErrTxt] = useState<string>('');

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
    navigation.navigate(Screen.Home, {apps: APPS});
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

  return (
    <KeyboardAvoidingView behavior="position" keyboardVerticalOffset={100}>
      <Header text={'Phone options'} />
      <View style={optionStyle}>
        <Button title="Phone Settings" onPress={openApp(SETTINGS)} />
      </View>
      <View style={optionStyle}>
        <Button title="Default Launcher" onPress={openApp(LAUNCHER)} />
      </View>
      {apps.length > 0 && (
        <View>
          <Header text={'Install apps'} />
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
      <Header text={'Configure app'} />
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
            />
          )}
          name="homeAddress"
        />
        {errors.homeAddress && <Text>This is required.</Text>}
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
        {errors.emerContact1 && <Text>This is required.</Text>}
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
      <Text>{errTxt}</Text>
      <Button title="Submit" onPress={handleSubmit(onSubmit)} />
    </KeyboardAvoidingView>
  );
};

async function wait(sec: number) {
  return new Promise(res => setTimeout(res, sec * 1000));
}

async function getEmergencyContacts(): Promise<Contacts.Contact[]> {
  const data = await getAppData();
  if (data === null) {
    return [];
  }
  const ids: string[] = [data.emerContact1];
  return (await getContacts()).filter(cnt => ids.includes(cnt.recordID));
}

export async function emergencyCalls() {
  const emerContacts = await getEmergencyContacts();
  if (emerContacts.length === 0) {
    alertAndWarn('No emergency contacts have been added. Call 911!');
    return;
  }

  for (const contact of emerContacts) {
    // SendIntentAndroid.sendSms(
    //   contact.phoneNumbers[0].number,
    //   'I have pressed the emergency button on my phone! Please call ASAP!',
    // );
    SmsAndroid.sms(
      contact.phoneNumbers[0].number.replace(/[^0-9]/g, ''),
      'I have pressed the emergency button on my phone! Please call ASAP!',
      'sendDirect',
      (err: Error, msg: string) => {
        if (err) {
          console.warn(err);
          Alert.alert('Failed to send emergency text msg');
        } else {
          console.log(msg);
        }
      },
    );

    // TODO: finish
    const callDetector = new CallDetectorManager(
      (event: string, phoneNumber: string) => {
        console.log(`Call state: ${event}, phone: ${phoneNumber}`);
        // Ignore iOS call states
        if (event === 'Disconnected') {
          // qqq
        } else if (event === 'Incoming') {
          // qqq
        } else if (event === 'Offhook') {
          // At least one call exists that is dialing, active, or on hold,
          // and no calls are ringing or waiting.
          // qqq
        } else if (event === 'Missed') {
          // qqq
        }
      },
      true,
    );

    callPhone(contact.phoneNumbers[0].number);
    console.log(`Called: ${contact.phoneNumbers[0].number}`);
    await wait(60);
    callDetector.dispose();
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
    Alert.alert(`Unable to install package: ${app.depPackage}`);
  }
  if (!app.cbParams) {
    app.cbParams = [];
  }

  if (app.screen) {
    switch (app.screen) {
      case Screen.ContactList:
        navigation.navigate(app.screen, {app: app});
        break;
      case Screen.Extras:
        navigation.navigate(app.screen, {apps: EXTRA_APPS});
        break;
      case Screen.Configure:
        navigation.navigate(app.screen);
        break;
      default:
        alertAndWarn(`Unknown screen: ${app.screen}`);
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
      Alert.alert(`Bad URL: ${app.url}`);
    }
  } else if (app.package) {
    try {
      await SendIntentAndroid.openApp(app.package, {});
    } catch (err) {
      console.warn(err);
      Alert.alert(`Bad pkg: ${app.package}`);
    }
  } else if (app.callback) {
    try {
      getExport(app.callback)(...app.cbParams);
    } catch (err) {
      console.warn(err);
      Alert.alert(`Bad app callback: ${app.name}`);
    }
  } else if (app.asyncCallback) {
    try {
      await getExport(app.asyncCallback)(...app.cbParams);
    } catch (err) {
      console.warn(err);
      Alert.alert(`Bad app callback: ${app.name}`);
    }
  } else {
    console.warn(JSON.stringify(app));
    Alert.alert(`Invalid app: ${app.name}`);
  }
}

// Re-enable when we fix the callback render issue
// const AlertModal = () => {
//   const tailwind = useTailwind();

//   const [modalVisible, setModalVisible] = globalStore.useState('modalVisible');
//   const [modalText] = globalStore.useState('modalText');

//   return (
//     <Modal
//       animationType="fade"
//       transparent={true}
//       visible={modalVisible}
//       onShow={() => {
//         setTimeout(() => {
//           setModalVisible(!modalVisible);
//         }, 2000);
//       }}
//       onRequestClose={() => {
//         setModalVisible(!modalVisible);
//       }}>
//       <View style={tailwind('flex justify-center')}>
//         <View style={tailwind('rounded-xl mb-4 bg-red-200')}>
//           <Text style={tailwind('text-4xl text-center font-bold text-black')}>
//             {modalText}
//           </Text>
//         </View>
//       </View>
//     </Modal>
//   );
// };

const AppOption = (props: {app: App; navigation: NavProp}) => {
  const tailwind = useTailwind();

  return (
    <View style={tailwind('flex w-1/3')}>
      <View
        style={tailwind(
          'rounded-md m-1 items-center border border-indigo-600 bg-white',
        )}>
        <TouchableOpacity
          key={props.app.key}
          onPress={async () => await handleApp(props.app, props.navigation)}>
          <Icon name={props.app.icon} size={90} color="#b00" />
          <Text style={tailwind('text-xl text-center font-bold text-black')}>
            {props.app.name}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

function getDateTime() {
  // Format by handle to avoid 6MB Intl library.
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
  }, []);

  return <Header text={dt} />;
};

const AppPanel = ({navigation, route}: HomeProps | ExtrasProps) => {
  const tailwind = useTailwind();

  useEffect(() => {
    getAppData()
      .then(data => {
        // Only load the configure screen once in app lifetime.
        if (data === null) {
          navigation.navigate(Screen.Configure);
        }
      })
      .catch(console.warn);
  });

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

const App = () => {
  useEffect(() => {
    try {
      let lastBatteryState = 1.0;
      const unsubscribe = BatteryMonitor.onStateChange(status => {
        if (status.state !== 'unplugged') {
          lastBatteryState = status.level;
          return;
        }
        for (const level of BATTERY_LEVELS) {
          if (lastBatteryState > level && status.level <= level) {
            const msg =
              status.level >= 0.05
                ? 'Please charge phone.'
                : 'Charge phone immediately!';
            const lvl = Math.round(status.level * 100);
            Alert.alert(`Warning, battery is low (${lvl}%). ${msg}`);
            break;
          }
        }
        lastBatteryState = status.level;
      });
      return () => unsubscribe();
    } catch {}
  }, []);

  return (
    <TailwindProvider utilities={utilities}>
      <NavigationContainer>
        <RootStack.Navigator initialRouteName={Screen.Home}>
          <RootStack.Screen
            name={Screen.Home}
            component={AppPanel}
            initialParams={{apps: APPS}}
          />
          <RootStack.Screen
            name={Screen.ContactList}
            component={ContactPanel}
            initialParams={{app: APPS[0]}}
          />
          <RootStack.Screen
            name={Screen.Extras}
            component={AppPanel}
            initialParams={{apps: EXTRA_APPS}}
          />
          <RootStack.Screen
            name={Screen.Configure}
            component={ConfigurePanel}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </TailwindProvider>
  );
};

export default App;
