import { query } from '../infra/db.js';
import { EC2Client, DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import gcpCompute from '@google-cloud/compute';
const { Compute } = gcpCompute;
import { ClientSecretCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';

class CloudConfigService {
  async getConfigs(userId) {
    try {
      const res = await query(
        'SELECT * FROM cloud_configs WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      return res.rows.map(r => ({
        id: r.id,
        provider: r.provider,
        name: r.name,
        region: r.region,
        isDefault: r.is_default,
        createdAt: r.created_at,
        // Don't return sensitive credentials
        hasCredentials: !!(r.access_key_id || r.service_account_key || r.client_id)
      }));
    } catch (e) {
      console.error('Error fetching cloud configs:', e);
      return [];
    }
  }

  async getConfigById(userId, configId) {
    try {
      const res = await query(
        'SELECT * FROM cloud_configs WHERE id = $1 AND user_id = $2',
        [configId, userId]
      );
      if (!res.rows[0]) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        provider: r.provider,
        name: r.name,
        region: r.region,
        isDefault: r.is_default,
        awsAccessKeyId: r.access_key_id,
        awsSecretKey: r.secret_access_key,
        gcpServiceAccountKey: r.service_account_key,
        gcpProjectId: r.project_id,
        azureClientId: r.client_id,
        azureClientSecret: r.client_secret,
        azureTenantId: r.tenant_id,
        azureSubscriptionId: r.subscription_id
      };
    } catch (e) {
      console.error('Error fetching cloud config:', e);
      return null;
    }
  }

  async saveConfig(userId, config) {
    const { provider, name, region, credentials } = config;
    
    let sql, params;
    
    if (provider === 'aws') {
      sql = `
        INSERT INTO cloud_configs (user_id, provider, name, region, access_key_id, secret_access_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, provider, name, region, is_default, created_at
      `;
      params = [userId, provider, name, region, credentials.accessKeyId, credentials.secretAccessKey];
    } else if (provider === 'gcp') {
      sql = `
        INSERT INTO cloud_configs (user_id, provider, name, region, service_account_key, project_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, provider, name, region, is_default, created_at
      `;
      params = [userId, provider, name, region, credentials.serviceAccountKey, credentials.projectId];
    } else if (provider === 'azure') {
      sql = `
        INSERT INTO cloud_configs (user_id, provider, name, region, client_id, client_secret, tenant_id, subscription_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, provider, name, region, is_default, created_at
      `;
      params = [userId, provider, name, region, credentials.clientId, credentials.clientSecret, credentials.tenantId, credentials.subscriptionId];
    } else {
      throw new Error('Unsupported provider: ' + provider);
    }

    const res = await query(sql, params);
    return res.rows[0];
  }

  async deleteConfig(userId, configId) {
    await query('DELETE FROM cloud_configs WHERE id = $1 AND user_id = $2', [configId, userId]);
    return { success: true };
  }

  async validateAwsCredentials(accessKeyId, secretAccessKey, region) {
    try {
      const client = new EC2Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      });
      
      await client.send(new DescribeRegionsCommand({}));
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async validateGcpCredentials(serviceAccountKey, projectId) {
    try {
      const keyJson = JSON.parse(serviceAccountKey);
      const compute = new Compute({
        projectId: projectId || keyJson.project_id,
        credentials: keyJson
      });
      
      // Try to list zones to validate credentials
      await compute.getZones({ maxResults: 1 });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async validateAzureCredentials(clientId, clientSecret, tenantId, subscriptionId) {
    try {
      const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
      const client = new ResourceManagementClient(credential, subscriptionId);
      
      // Try to list resource groups to validate credentials
      await client.resourceGroups.list({ top: 1 });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async testConfig(userId, configId) {
    const config = await this.getConfigById(userId, configId);
    if (!config) {
      return { valid: false, error: 'Configuration not found' };
    }

    if (config.provider === 'aws') {
      return this.validateAwsCredentials(config.awsAccessKeyId, config.awsSecretKey, config.region);
    } else if (config.provider === 'gcp') {
      return this.validateGcpCredentials(config.gcpServiceAccountKey, config.gcpProjectId);
    } else if (config.provider === 'azure') {
      return this.validateAzureCredentials(config.azureClientId, config.azureClientSecret, config.azureTenantId, config.azureSubscriptionId);
    }

    return { valid: false, error: 'Unknown provider' };
  }
}

export const cloudConfigService = new CloudConfigService();
