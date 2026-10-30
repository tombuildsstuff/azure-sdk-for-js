// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isNodeLike } from "@azure/core-util";

/**
 * Describes the cloud an application targets, as declared by the process environment.
 * @internal
 */
export interface CloudEnvironment {
  /** Canonical cloud name: `AzureCloud`, `AzureUSGovernment`, `AzureChinaCloud` or `custom`. */
  name: string;
  /** Base URL of the cloud's Microsoft Entra authority. */
  authorityHost: string;
  /** Base URL of the cloud's Azure Resource Manager, or undefined for a built-in cloud. */
  resourceManagerEndpoint?: string;
  /** Audience for Azure Resource Manager access tokens, or undefined for a built-in cloud. */
  resourceManagerAudience?: string;
}

/** @internal */
export const AzureCloudName = "AzureCloud";
/** @internal */
export const AzureUSGovernmentName = "AzureUSGovernment";
/** @internal */
export const AzureChinaCloudName = "AzureChinaCloud";
/** @internal */
export const CustomCloudName = "custom";

const AzurePublicAuthority = "https://login.microsoftonline.com";
const AzureUSGovernmentAuthority = "https://login.microsoftonline.us";
const AzureChinaAuthority = "https://login.chinacloudapi.cn";

// Three vocabularies are in play for AZURE_CLOUD and all are accepted.
//
//  - "AzureCloud" and friends are the canonical cross-SDK spelling, matching `az cloud list`.
//  - "AZURE_PUBLIC_CLOUD" and friends are the values Java's com.azure.core.models.AzureCloud and
//    Python's azure.core.AzureClouds already ship. Those DIVERGE from the canonical cross-SDK
//    spelling; the divergence predates this resolver and is preserved for compatibility only.
//  - "AZURE", "AZURE_CHINA" and "AZURE_US_GOVERNMENT" are Spring Cloud Azure's CloudType values.
//    Spring already maps AZURE_CLOUD onto its profile.cloud-type property, so rejecting them
//    would break applications that set this variable today.
const builtInClouds: Record<string, [string, string]> = {
  azurecloud: [AzureCloudName, AzurePublicAuthority],
  public: [AzureCloudName, AzurePublicAuthority],
  azure_public_cloud: [AzureCloudName, AzurePublicAuthority],
  azure: [AzureCloudName, AzurePublicAuthority],
  azureusgovernment: [AzureUSGovernmentName, AzureUSGovernmentAuthority],
  usgovernment: [AzureUSGovernmentName, AzureUSGovernmentAuthority],
  azure_us_government: [AzureUSGovernmentName, AzureUSGovernmentAuthority],
  azurechinacloud: [AzureChinaCloudName, AzureChinaAuthority],
  china: [AzureChinaCloudName, AzureChinaAuthority],
  azure_china_cloud: [AzureChinaCloudName, AzureChinaAuthority],
  azure_china: [AzureChinaCloudName, AzureChinaAuthority],
};

function readEnv(name: string): string | undefined {
  if (!isNodeLike) {
    return undefined;
  }
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function validateHttps(variable: string, value: string): void {
  if (!value.toLowerCase().startsWith("https://")) {
    throw new Error(`${variable} must use https. Got "${value}".`);
  }
  if (value.length <= "https://".length) {
    throw new Error(`${variable} must specify a host. Got "${value}".`);
  }
}

/**
 * Resolves the cloud described by the process environment.
 *
 * `AZURE_CLOUD` is the activation switch. When it names a built-in cloud, that cloud is described
 * and the other variables are ignored. Only the value `custom` causes `AZURE_AUTHORITY_HOST`,
 * `AZURE_RESOURCE_MANAGER_ENDPOINT` and `AZURE_RESOURCE_MANAGER_AUDIENCE` to be read, and then all
 * three are required.
 *
 * @returns the resolved environment, or undefined when `AZURE_CLOUD` isn't set.
 * @internal
 */
export function getCloudEnvironment(): CloudEnvironment | undefined {
  const name = readEnv("AZURE_CLOUD");
  if (name === undefined) {
    return undefined;
  }

  const key = name.toLowerCase();
  const builtIn = builtInClouds[key];
  if (builtIn) {
    return { name: builtIn[0], authorityHost: builtIn[1] };
  }

  if (key === "other") {
    // Spring Cloud Azure's CloudType.OTHER means "I configure endpoints myself", not "read the
    // endpoint variables". Treating it as a custom cloud would demand variables such an
    // application has never set, so it is treated as though AZURE_CLOUD were unset.
    return undefined;
  }

  if (key === "azure_germany") {
    throw new Error("AZURE_CLOUD names Microsoft Cloud Germany, which closed on October 29th, 2021.");
  }

  if (key !== "custom") {
    throw new Error(
      `AZURE_CLOUD has unrecognized value "${name}". Valid values are ${AzureCloudName}, ${AzureUSGovernmentName}, ${AzureChinaCloudName} and ${CustomCloudName}.`,
    );
  }

  const authorityHost = readEnv("AZURE_AUTHORITY_HOST");
  const endpoint = readEnv("AZURE_RESOURCE_MANAGER_ENDPOINT");
  const audience = readEnv("AZURE_RESOURCE_MANAGER_AUDIENCE");

  const missing = (
    [
      ["AZURE_AUTHORITY_HOST", authorityHost],
      ["AZURE_RESOURCE_MANAGER_ENDPOINT", endpoint],
      ["AZURE_RESOURCE_MANAGER_AUDIENCE", audience],
    ] as [string, string | undefined][]
  )
    .filter(([, value]) => value === undefined)
    .map(([variable]) => variable);

  if (missing.length > 0) {
    throw new Error(
      `AZURE_CLOUD is "custom" but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        `A custom cloud requires all of AZURE_AUTHORITY_HOST, AZURE_RESOURCE_MANAGER_ENDPOINT and AZURE_RESOURCE_MANAGER_AUDIENCE.`,
    );
  }

  validateHttps("AZURE_AUTHORITY_HOST", authorityHost!);
  validateHttps("AZURE_RESOURCE_MANAGER_ENDPOINT", endpoint!);
  validateHttps("AZURE_RESOURCE_MANAGER_AUDIENCE", audience!);

  return {
    name: CustomCloudName,
    authorityHost: authorityHost!,
    resourceManagerEndpoint: endpoint,
    resourceManagerAudience: audience,
  };
}

/**
 * Reads `AZURE_DISABLE_INSTANCE_DISCOVERY`.
 *
 * @returns the parsed value, or undefined when the variable isn't set.
 * @internal
 */
export function getDisableInstanceDiscoveryFromEnvironment(): boolean | undefined {
  const value = readEnv("AZURE_DISABLE_INSTANCE_DISCOVERY");
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(
    `Invalid value "${value}" for AZURE_DISABLE_INSTANCE_DISCOVERY. Set it to true or false.`,
  );
}
