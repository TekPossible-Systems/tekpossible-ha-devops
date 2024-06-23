import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Misc Imports
import { readFileSync } from 'fs';
import { exit } from 'process';

// Import CDK Libraries
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';


function create_repos(scope: Construct, region_name: string, config: any): codecommit.Repository[] {
  var repo_list: codecommit.Repository[] = [];
  /*
  Format for repo: 
  {
    "name": "Name of the repository",
    "desc": "Description of the repository - human readable summary",
    "type": "Type of the repo - can either be ami, software, infrastructure, or devops"
  }

  Note: devops is the only one that does not have a CI/CD Pipeline - that is because it was simpler just to use cdk deploy since it creates the rest of the pipelines
  */
  config.repos.forEach(function(repo: any) {
    var tekpossible_repo = new codecommit.Repository(scope, config.stack_name + "-" + repo.name, {
      repositoryName: repo.name, 
      description: repo.desc
    });
    repo_list.push(tekpossible_repo);
  });

  return(repo_list);

  }

  
  function getRepoFromType(desiredType: any, config: any, repo_list: codecommit.Repository[]): any {
    var repo = null;
    var temp_name = "";
    config.repos.forEach(function(temp_repo: any){
      if(temp_repo.type == desiredType) {
        temp_name = temp_repo.name;
      } 
    });
    repo_list.forEach(function(cfn_repo){
      if(cfn_repo.repositoryName == temp_name)
        repo = cfn_repo;
    });
    return repo;
  }

function create_software_workflow(scope: Construct, region_name: string, config: any, repos: codecommit.Repository[]){
  const software_repo = getRepoFromType("software", config, repos);
  const image_repo = getRepoFromType("ami", config, repos);
  // Step 1 - Create IAM Roles needed for the Bucket and Pipeline - The CodeBuild Container will need access to codecommit as well
  // Step 2 - Create S3 Bucket for Software TAR Output
  // Step 3 - Create the Build/Lint Pipeline
  // Step 4 - Create the Deploy Pipeline (actually just the last part of the build pipeline after the bucket is outputted)
 
}

function create_image_workflow(scope: Construct, region_name: string, config: any, repos: codecommit.Repository[]){
  const image_repo = getRepoFromType("ami", config, repos);
  const infrastructure_repo = getRepoFromType("infrastructure", config, repos);
  // Step 1 - Create IAM Roles needed - The ImageBuilder EC2 instance will need access to s3 buckets to pull down the tar file mentioned in the software pipeline
  // Step 2 - Create the Code Pipeline and Image Pipeline - Make the image pipeline run stuff from the configs based off of the ami repo config 
  // Step 3 - Write the new ami to the config.json on the infrastructure repo

}

function create_infrastructure_workflow(scope: Construct, region_name: string, config: any, repos: codecommit.Repository[]){ 
  const infrastructure_repo = getRepoFromType("infrastructure", config, repos);
  
  // Step 1 - Create IAM Roles needed - The Codepipeline role will need admin access to deploy the stack in cloudformation
  const infra_codepipeline_iam_role = new iam.Role(scope, config.stack_name + '-Infra-CodePipelineRole', {
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal("ec2.amazonaws.com"),
      new iam.ServicePrincipal("codebuild.amazonaws.com"),
      new iam.ServicePrincipal("codedeploy.amazonaws.com"), 
      new iam.ServicePrincipal("codecommit.amazonaws.com"),
      new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      new iam.ServicePrincipal("sns.amazonaws.com"),
      new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      new iam.ServicePrincipal("s3.amazonaws.com") 
    ),
    roleName: config.stack_name + '-Infra-CodePipelineRole'
    });

  // Admin access is granted here so that CloudFormation can properly deploy the infrastructure
  infra_codepipeline_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-InfraCodePipelineInfraMP1", "arn:aws:iam::aws:policy/AdministratorAccess"));
  
  // Step 2 - Create the S3 bucket used to get the synthesized CDK outputs
  const codepipeline_s3_bucket =  new s3.Bucket(scope, config.stack_name + "-infrastructure-pipeline-storage", {
    versioned: true, 
    bucketName: config.stack_name.toLowerCase( ) + "-infrastructure-pipeline-storage",
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true
  });

  // Step 3 - Create the SNS Stuff so that approvals are required
  // Grab email PoC for the repo - this will be where sns notifications are sent for approvals. Fail if there is not email set.
  var sns_email = "";
  config.repos.forEach(function(repo: any){
    if(repo.type == "infrastructure") {
      sns_email = repo.email_poc;
    }
  });

  if (sns_email == undefined){
    console.log("You forgot to set the email poc for the infrastructure repo! Failing due to undefined variable!")
    exit(1)
  }

  const infra_codepipeline_sns_topic = new sns.Topic(scope, config.stack_name + '-infra-codepipeline-sns-topic', {
    topicName: config.stack_name + '-infra-codepipeline-sns-topic',
    displayName: config.stack_name + "Infrastructure Codepipeline SNS Approval"
  });

  const infra_codepipeline_sns_subscription = new sns.Subscription(scope, config.stack_name + "-infra-codepipeline-sns-sub", {
    topic: infra_codepipeline_sns_topic,
    protocol: sns.SubscriptionProtocol.EMAIL,
    endpoint: sns_email
  });
  // Step 4 - Create codepipeline structures

}

export class DevopsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creation of repos is needed first so that the pipelines can trigger eachother
    const repo_list = create_repos(this, config.region, config);

    // The following functions create the overall development workflow
    // Software Pipeline -> Image Pipeline -> Infrastructure Pipeline

    // // Create Software Repo and Pipeline
    // create_software_workflow(this, config.region, config, repo_list);

    // // Create AMI Repo and Pipeline
    // create_image_workflow(this, config.region, config, repo_list);

    // // Create Infrastructure Repo and Pipeline
    create_infrastructure_workflow(this, config.region, config, repo_list);

  }
}
