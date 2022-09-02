import { ApolloProvider, gql, useQuery } from '@apollo/client';
import * as AuthSession from 'expo-auth-session';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { FC, StrictMode, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Platform, StyleSheet, Text, View } from 'react-native';
import { createBackendClient, verifyJwt } from './util';
import * as config from './util/config';

WebBrowser.maybeCompleteAuthSession();

const useProxy = Platform.select({ web: false, default: true });
const redirectUri = AuthSession.makeRedirectUri({ useProxy });

console.log(`Redirect URL: ${redirectUri}`);

interface IAuthProp {
  setJwt: React.Dispatch<React.SetStateAction<string | null>>;
}

const Auth: FC<IAuthProp> = (props) => {
  const [name, setName] = useState<string | null>(null);

  const [request, result, promptAsync] = AuthSession.useAuthRequest(
    {
      redirectUri,
      clientId: config.AUTH0_CLIENT_ID,
      responseType: "id_token",
      scopes: ["openid", "profile", "email"],
      extraParams: {
        nonce: "nonce",
      },
    },
    {
      authorizationEndpoint: `${config.AUTH0_URL}/authorize`,
    }
  );

  useEffect(() => {
    if (result === null) {
      return;
    } else if (result.type === "success") {
      // Retrieve the JWT token and decode it
      const jwtToken = result.params.id_token;
      verifyJwt(jwtToken).then((decoded) => {
        props.setJwt(jwtToken)
        const { name } = decoded?.payload;
        setName(name as string);
      });
    } else {
      const alertTitle = "Authentication error";
      const alertText = (result.type === "error" ? result.params?.error_description : null) ?? "something went wrong";
      if (Platform.OS === 'web') {
        alert(alertText)
      } else {
        Alert.alert(alertTitle, alertText);
      }
    }
  }, [result]);

  return (
    <>
      {name ? (
        <>
          <Text >You are logged in, {name}!</Text>
          <Button title="Log out" onPress={() => setName(null)} />
        </>
      ) : (
        <Button
          disabled={!request}
          title="Log in with Auth0"
          onPress={() => promptAsync({ useProxy })}
        />
      )}
    </>
  );
};

const DisplayBackendVersion: FC = () => {
  const { loading, error, data } = useQuery(gql`query Version{version}`);
  if (loading) return <Text>Loading...</Text>;
  if (error) {
    console.error(error);
    return <Text>Error :(</Text>;
  }

  return (
    <Text>
      Backend version: {data.version}
    </Text>
  );
};

const App: FC = () => {
  const [jwt, setJwt] = useState<string | null>(null);
  const apolloClient = useMemo(() => { return jwt ? createBackendClient(jwt) : createBackendClient() }, [jwt]);
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <ApolloProvider client={apolloClient}>
        <StrictMode>
          <DisplayBackendVersion />
        </StrictMode>
      </ApolloProvider>
      <StatusBar style="auto" />
      <Auth setJwt={setJwt} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;