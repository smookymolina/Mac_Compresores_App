import type { CapacitorConfig } from "@capacitor/cli";

// La URL del servidor NO va aquí: la app empaqueta dist/ y llama a la API definida en VITE_API_URL al compilar.
const config: CapacitorConfig = {
  appId: "mx.com.maccompresores.campo",
  appName: "MAC Campo",
  webDir: "dist",
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
      iosIsEncryption: true,
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosKeychainPrefix: "mac-campo",
      androidBiometric: { biometricAuth: false },
      iosBiometric: { biometricAuth: false },
    },
  },
};

export default config;
