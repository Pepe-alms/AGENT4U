import { Stack } from "expo-router";
import { FavoritesProvider } from "../context/FavoritesContext";

export default function RootLayout() {
  return (
    <FavoritesProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="detail" options={{ headerShown: true, title: '', headerBackTitle: 'Volver' }} />
      </Stack>
    </FavoritesProvider>
  );
}