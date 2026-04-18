import { query } from '../infra/db.js';
import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ClientSecretCredential } from '@azure/identity';
import { ResourceManagementClient } from '@azure/arm-resources';
import { NetworkManagementClient } from '@azure/arm-network';
import { v4 as uuidv4 } from 'uuid';

// Lazy load GCP Compute to avoid ESM issues
let Compute;
async function getGcpCompute(credentials) {
  if (!Compute) {
    const gcpModule = await import('@google-cloud/compute');
    Compute = gcpModule.default.Compute;
  }
  return new Compute({ credentials });
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';
const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free';

class InfrastructureService {
  async discoverExistingInfrastructure(userId, configId) {
    const configRes = await query(
      'SELECT * FROM cloud_configs WHERE id = $1 AND user_id = $2',
      [configId, userId]
    );
    
    if (!configRes.rows[0]) {
      throw new Error('Cloud configuration not found');
    }

    const config = configRes.rows[0];
    const resources = [];

    try {
      if (config.provider === 'aws') {
        const ec2Client = new EC2Client({
          region: config.region,
          credentials: {
            accessKeyId: config.access_key_id,
            secretAccessKey: config.secret_access_key
          }
        });

        const rdsClient = new RDSClient({
          region: config.region,
          credentials: {
            accessKeyId: config.access_key_id,
            secretAccessKey: config.secret_access_key
          }
        });

        // Discover VPCs
        const vpcs = await ec2Client.send(new DescribeVpcsCommand({}));
        resources.push(...vpcs.Vpcs.map(vpc => ({
          type: 'vpc',
          id: vpc.VpcId,
          name: vpc.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed VPC',
          cidr: vpc.CidrBlock,
          isDefault: vpc.IsDefault
        })));

        // Discover Subnets
        const subnets = await ec2Client.send(new DescribeSubnetsCommand({}));
        resources.push(...subnets.Subnets.map(subnet => ({
          type: 'subnet',
          id: subnet.SubnetId,
          vpcId: subnet.VpcId,
          cidr: subnet.CidrBlock,
          az: subnet.AvailabilityZone,
          name: subnet.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed Subnet'
        })));

        // Discover EC2 Instances
        const instances = await ec2Client.send(new DescribeInstancesCommand({}));
        instances.Reservations.forEach(res => {
          res.Instances.forEach(inst => {
            if (inst.State.Name !== 'terminated') {
              resources.push({
                type: 'ec2',
                id: inst.InstanceId,
                instanceType: inst.InstanceType,
                state: inst.State.Name,
                name: inst.Tags?.find(t => t.Key === 'Name')?.Value || 'Unnamed Instance'
              });
            }
          });
        });

        // Discover RDS Instances
        const rdsInstances = await rdsClient.send(new DescribeDBInstancesCommand({}));
        resources.push(...rdsInstances.DBInstances.map(db => ({
          type: 'rds',
          id: db.DBInstanceIdentifier,
          engine: db.Engine,
          status: db.DBInstanceStatus,
          class: db.DBInstanceClass
        })));

      } else if (config.provider === 'gcp') {
        const keyJson = JSON.parse(config.service_account_key);
        const projectId = config.project_id || keyJson.project_id;
        
        const compute = await getGcpCompute(keyJson);

        // Discover VMs
        const [vms] = await compute.getVMs({ maxResults: 100 });
        resources.push(...vms.map(vm => ({
          type: 'gce',
          id: vm.id,
          name: vm.name,
          zone: vm.zone?.split('/').pop(),
          machineType: vm.machineType?.split('/').pop(),
          status: vm.status
        })));

        // Discover Networks
        const [networks] = await compute.getNetworks();
        resources.push(...networks.map(net => ({
          type: 'vpc',
          id: net.id,
          name: net.name,
          autoCreateSubnetworks: net.autoCreateSubnetworks
        })));

      } else if (config.provider === 'azure') {
        const credential = new ClientSecretCredential(
          config.tenant_id,
          config.client_id,
          config.client_secret
        );

        const resourceClient = new ResourceManagementClient(credential, config.subscription_id);
        const networkClient = new NetworkManagementClient(credential, config.subscription_id);

        // Discover Resource Groups
        const resourceGroups = await resourceClient.resourceGroups.list();
        for await (const rg of resourceGroups) {
          resources.push({
            type: 'resource_group',
            id: rg.id,
            name: rg.name,
            location: rg.location
          });

          // Discover VNets in each RG
          const vnets = await networkClient.virtualNetworks.list(rg.name);
          for await (const vnet of vnets) {
            resources.push({
              type: 'vnet',
              id: vnet.id,
              name: vnet.name,
              resourceGroup: rg.name,
              addressSpace: vnet.addressSpace?.addressPrefixes
            });
          }
        }
      }
    } catch (error) {
      console.error('Error discovering infrastructure:', error);
      throw new Error('Failed to discover infrastructure: ' + error.message);
    }

    return { provider: config.provider, region: config.region, resources };
  }

  async generateInfrastructurePlan(userId, configId, prompt) {
    // Get existing infrastructure context
    const existingInfra = await this.discoverExistingInfrastructure(userId, configId).catch(() => ({ resources: [] }));
    
    const configRes = await query(
      'SELECT * FROM cloud_configs WHERE id = $1 AND user_id = $2',
      [configId, userId]
    );
    const config = configRes.rows[0];

    // Build system prompt for infrastructure planning
    const systemPrompt = `You are an expert infrastructure architect. Generate Terraform configurations based on user requests.

Current Infrastructure Context:
${JSON.stringify(existingInfra.resources, null, 2)}

Cloud Provider: ${config.provider}
Region: ${config.region}

Rules:
1. Generate valid HCL2 Terraform code
2. Use the appropriate provider for ${config.provider}
3. Include all necessary variables and outputs
4. Add proper tags/labels for resource identification
5. Follow security best practices (enable encryption, restrict security groups)
6. If the user mentions an existing resource (like VPC), reference it with data sources instead of creating new

Respond with JSON in this exact format:
{
  "planId": "unique-id",
  "summary": "Brief description of what will be created",
  "resources": ["list of resources to be created"],
  "estimatedCost": "monthly cost estimate or TBD",
  "terraformCode": "complete terraform code as a string"
}`;

    // Call OpenRouter API (same as DevAI)
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error('AI planning failed: ' + await response.text());
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Parse AI response
    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      const plan = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
      
      // Save plan to database
      const planId = uuidv4();
      await query(
        `INSERT INTO infrastructure_plans (id, user_id, config_id, prompt, summary, resources, estimated_cost, terraform_code, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [planId, userId, configId, prompt, plan.summary, JSON.stringify(plan.resources), plan.estimatedCost, plan.terraformCode, 'draft']
      );

      return {
        planId,
        summary: plan.summary,
        resources: plan.resources,
        estimatedCost: plan.estimatedCost,
        terraformCode: plan.terraformCode
      };
    } catch (e) {
      console.error('Error parsing AI response:', e);
      throw new Error('Failed to parse infrastructure plan');
    }
  }

  async getPlans(userId) {
    const res = await query(
      `SELECT p.*, c.provider, c.region, c.name as config_name 
       FROM infrastructure_plans p
       JOIN cloud_configs c ON p.config_id = c.id
       WHERE p.user_id = $1 
       ORDER BY p.created_at DESC`,
      [userId]
    );
    return res.rows;
  }

  async getPlanById(userId, planId) {
    const res = await query(
      `SELECT p.*, c.provider, c.region, c.name as config_name,
              c.access_key_id, c.secret_access_key, c.service_account_key, c.project_id,
              c.client_id, c.client_secret, c.tenant_id, c.subscription_id
       FROM infrastructure_plans p
       JOIN cloud_configs c ON p.config_id = c.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [planId, userId]
    );
    return res.rows[0];
  }
}

export const infrastructureService = new InfrastructureService();
