import { ClientError, gql, GraphQLClient } from 'graphql-request';
import type { IFs } from 'memfs';

const CEREBRO_URL = "https://cerebro.cloud.dgraph.io";

type BackendInfo = {
    uid: string,
    name: string,
    zone: string,
    url: string,
    owner: string,
    jwtToken: string,
    deploymentMode: string,
    deploymentType: string,
    lambdaScript: string,
};

function rejectGraphQLError(error: Error, reject: (reason?: any) => void = (reason) => { throw reason }) {
    if (error.name === ClientError.name)
        (error as ClientError).response.errors?.forEach((err) => {
            reject(new Error(err.message));
        });
    else
        reject(error);
}

export function getCerebroJWT(email: string, password: string): Promise<string> {
    return new Promise(async (resolver, reject) => {
        const LOGIN = gql`
            query Login($email: String!, $password: String!) {
                login(email: $email, password: $password) {
                    token
                }
            }
        `;
        const VARIABLE = {
            email,
            password
        };
        const cerebro_client = new GraphQLClient(`${CEREBRO_URL}/graphql`);
        const CEREBRO_JWT = await cerebro_client.request(LOGIN, VARIABLE)
            .then((data: { login: { token: string } }) => resolver(data.login.token))
            .catch(error => rejectGraphQLError(error, reject));
    })
}
export function getCerebroClient(cerebro_jwt: string): Promise<GraphQLClient> {
    return new Promise((resolver) => {
        const deployment_client = new GraphQLClient(`${CEREBRO_URL}/graphql`);
        resolver(deployment_client.setHeader('authorization', `Bearer ${cerebro_jwt}`));
    });
}
export function getBackendInfo(cerebro_client: GraphQLClient, name: string): Promise<BackendInfo> {
    return new Promise(async (resolver, reject) => {
        const GET_DEPLOYMENTS = gql`
            {
                deployments {
                    uid
                    name
                    zone
                    url
                    owner
                    jwtToken
                    deploymentMode
                    deploymentType
                    lambdaScript
                }
            }
        `;
        const deployments: BackendInfo[] = await cerebro_client.request(GET_DEPLOYMENTS)
            .then((data) => data.deployments)
            .catch(error => rejectGraphQLError(error, reject));
        const backend_info = deployments.filter((deployment) => deployment.name === name)[0]
        resolver(backend_info);
    })
}
export function getDeploymentClient(backend_url: string, jwtToken?: string): Promise<GraphQLClient> {
    return new Promise((resolver) => {
        const deployment_client = new GraphQLClient(`${backend_url}/admin`);
        if (jwtToken)
            deployment_client.setHeader('X-Auth-Token', jwtToken);
        resolver(deployment_client);
    });
}
export function buildSchema(schema_path: string, args: { AUTH0_PUBLIC_KEY: string, AUTH0_CLIENT_ID: string }): Promise<string> {
    return new Promise(async (resolver, reject) => {
        const fs = await import('node:fs');
        const schema_file = fs.readFileSync(schema_path);
        const schema = `
${schema_file.toString()}

# Dgraph.Authorization {"VerificationKey":"${JSON.stringify(args.AUTH0_PUBLIC_KEY).slice(1, -1)}","Header":"X-Auth-Token","Namespace":"https://dgraph.io/jwt/claims","Algo":"RS256","Audience":["${args.AUTH0_CLIENT_ID}"]}

`;
        resolver(schema);
    });
}
export function updateSchema(deployment_client: GraphQLClient, schema: string): Promise<any> {
    return new Promise((resolver, reject) => {
        const UPDATE_SCHEMA = gql`
            mutation($schema: String!) {
                updateGQLSchema(input: { set: { schema: $schema } }) {
                    gqlSchema {
                    schema
                    }
                }
            }
        `;
        const VARIABLE = {
            schema
        };
        deployment_client.request(UPDATE_SCHEMA, VARIABLE)
            .then(response => resolver(response))
            .catch(error => rejectGraphQLError(error, reject));
    });
}
export function buildLambda(isProduction: boolean = false, fs?: IFs): Promise<string> {
    return new Promise(async (resolver, reject) => {
        const path = await import('path');
        const webpack = (await import('webpack').then(webpack => webpack as unknown as typeof webpack.default));
        const config = (await import('../webpack.config').then(config => config as unknown as typeof config.default))(isProduction);
        const compiler = webpack(config);
        if (fs)
            compiler.outputFileSystem = fs;
        compiler.run((err) => {
            if (err) reject(err);
            compiler.close((closeErr) => {
                if (closeErr) reject(closeErr);
                resolver(fs.readFileSync((path.posix ?? path).join(config.output.path, config.output.filename)).toString())
            });
        });
    });
}
export function updateLambda(cerebro_client: GraphQLClient, backend_uid: string): Promise<any> {
    return new Promise(async (resolver, reject) => {
        const { createFsFromVolume, Volume } = await import('memfs');
        const fs = createFsFromVolume(new Volume());
        buildLambda(true, fs).then(async (content) => {
            const { encode } = await import('base-64');
            const UPDATE_LAMBDA = gql`
                mutation updateLambda($input: UpdateLambdaInput!){
                    updateLambda(input: $input)
                }
            `;
            const encoded = encode(content);
            const VARIABLE = {
                input: {
                    deploymentID: backend_uid,
                    tenantID: 0,
                    lambdaScript: encoded,
                }
            };
            cerebro_client.request(UPDATE_LAMBDA, VARIABLE)
                .then(response => resolver(response))
                .catch(error => rejectGraphQLError(error, reject));
        }).catch(err => reject(err));
    });
}