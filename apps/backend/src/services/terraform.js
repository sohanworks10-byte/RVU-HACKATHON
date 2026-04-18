import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { query } from '../infra/db.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import os from 'os';

class TerraformService {
  constructor() {
    this.workspaces = new Map(); // Track active deployments
  }

  async createWorkspace(planId, terraformCode, cloudConfig) {
    const workspaceDir = path.join(os.tmpdir(), 'alphainfra', planId);
    await fs.mkdir(workspaceDir, { recursive: true });

    // Write main.tf
    await fs.writeFile(path.join(workspaceDir, 'main.tf'), terraformCode);

    // Write provider configuration
    const providerConfig = this.generateProviderConfig(cloudConfig);
    await fs.writeFile(path.join(workspaceDir, 'providers.tf'), providerConfig);

    // Write variables.tf if needed
    const variablesConfig = this.generateVariablesConfig(cloudConfig);
    await fs.writeFile(path.join(workspaceDir, 'terraform.tfvars'), variablesConfig);

    return workspaceDir;
  }

  generateProviderConfig(config) {
    if (config.provider === 'aws') {
      return `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${config.region}"
  access_key = "${config.access_key_id}"
  secret_key = "${config.secret_access_key}"
}
`;
    } else if (config.provider === 'gcp') {
      const keyJson = JSON.parse(config.service_account_key);
      const projectId = config.project_id || keyJson.project_id;
      return `
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "${projectId}"
  region  = "${config.region}"
  credentials = file("gcp-credentials.json")
}
`;
    } else if (config.provider === 'azure') {
      return `
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = "${config.subscription_id}"
  client_id       = "${config.client_id}"
  client_secret   = "${config.client_secret}"
  tenant_id       = "${config.tenant_id}"
}
`;
    }
    return '';
  }

  generateVariablesConfig(config) {
    if (config.provider === 'gcp') {
      return `// GCP credentials handled via file`;
    }
    return '';
  }

  async runTerraform(workspaceDir, command, args = [], env = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('terraform', [command, ...args], {
        cwd: workspaceDir,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
        } else {
          reject({ stdout, stderr, code, error: `Terraform exited with code ${code}` });
        }
      });

      child.on('error', (error) => {
        reject({ error: error.message });
      });
    });
  }

  async executeDeployment(userId, planId) {
    // Get plan details
    const planRes = await query(
      `SELECT p.*, c.provider, c.region, c.name as config_name,
              c.access_key_id, c.secret_access_key, c.service_account_key, c.project_id,
              c.client_id, c.client_secret, c.tenant_id, c.subscription_id
       FROM infrastructure_plans p
       JOIN cloud_configs c ON p.config_id = c.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [planId, userId]
    );

    if (!planRes.rows[0]) {
      throw new Error('Plan not found');
    }

    const plan = planRes.rows[0];
    const deploymentId = uuidv4();

    // Create deployment record
    await query(
      `INSERT INTO deployments (id, plan_id, user_id, status, logs, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [deploymentId, planId, userId, 'initializing', JSON.stringify([])]
    );

    // Update plan status
    await query(
      'UPDATE infrastructure_plans SET status = $1 WHERE id = $2',
      ['deploying', planId]
    );

    // Run deployment in background
    this.runDeployment(deploymentId, plan);

    return { deploymentId, status: 'initializing' };
  }

  async runDeployment(deploymentId, plan) {
    const logs = [];
    const addLog = (level, message) => {
      const entry = { timestamp: new Date().toISOString(), level, message };
      logs.push(entry);
      // Update logs in database
      query('UPDATE deployments SET logs = $1 WHERE id = $2', [JSON.stringify(logs), deploymentId])
        .catch(console.error);
    };

    try {
      addLog('info', 'Creating Terraform workspace...');
      const workspaceDir = await this.createWorkspace(plan.id, plan.terraform_code, plan);

      // Write GCP credentials file if needed
      if (plan.provider === 'gcp') {
        await fs.writeFile(
          path.join(workspaceDir, 'gcp-credentials.json'),
          plan.service_account_key
        );
      }

      addLog('info', 'Running terraform init...');
      await this.runTerraform(workspaceDir, 'init');
      addLog('success', 'Terraform initialized successfully');

      await query('UPDATE deployments SET status = $1 WHERE id = $2', ['planning', deploymentId]);
      addLog('info', 'Running terraform plan...');
      const planResult = await this.runTerraform(workspaceDir, 'plan', ['-out=tfplan']);
      addLog('success', 'Terraform plan completed');

      await query('UPDATE deployments SET status = $1 WHERE id = $2', ['applying', deploymentId]);
      addLog('info', 'Running terraform apply...');
      addLog('warn', 'This may take several minutes...');
      
      const applyResult = await this.runTerraform(workspaceDir, 'apply', ['-auto-approve', 'tfplan']);
      addLog('success', 'Terraform apply completed successfully');

      // Parse outputs
      addLog('info', 'Retrieving outputs...');
      const outputResult = await this.runTerraform(workspaceDir, 'output', ['-json']);
      const outputs = JSON.parse(outputResult.stdout || '{}');

      await query(
        'UPDATE deployments SET status = $1, outputs = $2, completed_at = NOW() WHERE id = $3',
        ['completed', JSON.stringify(outputs), deploymentId]
      );

      await query(
        'UPDATE infrastructure_plans SET status = $1 WHERE id = $2',
        ['deployed', plan.id]
      );

      addLog('success', 'Deployment completed successfully!');

    } catch (error) {
      console.error('Deployment error:', error);
      addLog('error', error.error || error.message || 'Deployment failed');
      
      await query(
        'UPDATE deployments SET status = $1, error = $2 WHERE id = $3',
        ['failed', error.error || error.message, deploymentId]
      );

      await query(
        'UPDATE infrastructure_plans SET status = $1 WHERE id = $2',
        ['failed', plan.id]
      );
    }
  }

  async getDeploymentStatus(deploymentId) {
    const res = await query('SELECT * FROM deployments WHERE id = $1', [deploymentId]);
    if (!res.rows[0]) return null;
    
    const deployment = res.rows[0];
    return {
      id: deployment.id,
      status: deployment.status,
      logs: JSON.parse(deployment.logs || '[]'),
      outputs: JSON.parse(deployment.outputs || '{}'),
      error: deployment.error,
      createdAt: deployment.created_at,
      completedAt: deployment.completed_at
    };
  }

  async destroyDeployment(userId, planId) {
    const planRes = await query(
      `SELECT p.*, c.* FROM infrastructure_plans p
       JOIN cloud_configs c ON p.config_id = c.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [planId, userId]
    );

    if (!planRes.rows[0]) {
      throw new Error('Plan not found');
    }

    const plan = planRes.rows[0];
    const workspaceDir = path.join(os.tmpdir(), 'alphainfra', planId);

    // Recreate workspace if needed
    if (!await fs.access(workspaceDir).then(() => true).catch(() => false)) {
      await this.createWorkspace(planId, plan.terraform_code, plan);
      if (plan.provider === 'gcp') {
        await fs.writeFile(
          path.join(workspaceDir, 'gcp-credentials.json'),
          plan.service_account_key
        );
      }
      await this.runTerraform(workspaceDir, 'init');
    }

    // Run destroy
    const result = await this.runTerraform(workspaceDir, 'destroy', ['-auto-approve']);

    await query(
      'UPDATE infrastructure_plans SET status = $1 WHERE id = $2',
      ['destroyed', planId]
    );

    return { success: true, output: result.stdout };
  }
}

export const terraformService = new TerraformService();
