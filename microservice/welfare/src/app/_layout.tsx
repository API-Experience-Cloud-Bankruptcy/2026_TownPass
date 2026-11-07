import '@/global.css';

import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider } from '@/lib/app-state';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Head>
        <title>臺北市福利補助自己查</title>
      </Head>
      <AppStateProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
