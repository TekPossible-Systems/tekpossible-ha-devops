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
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';


var __infrastructure_repo: any;
var __image_repo: any;
var __software_repo: any;

function create_repos(scope: Construct, region_name: string, config: any) {
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
    if (repo.type == "software"){
      __software_repo = tekpossible_repo;
    } else if (repo.type == "image"){
      __image_repo = tekpossible_repo;

    } else if (repo.type == "infrastructure"){
      __infrastructure_repo = tekpossible_repo;
    }
  });


  }

  
  function getRepoFromType(desiredType: any, config: any, repo_list: codecommit.Repository[]): any {
    var repo = null;
    var temp_name = "";
    config.repos.forEach(function(temp_repo: any){
      if(temp_repo.type == desiredType) {
        temp_name = temp_repo.name;
      } 
    });
    repo_list.forEach(function(cfn_repo: codecommit.Repository){
      if(cfn_repo.repositoryName == temp_name)
        repo = cfn_repo;
      });
    return repo;
  }

function create_software_workflow(scope: Construct, region_name: string, config: any){
  // Step 1 - Create IAM Roles needed for the Bucket and Pipeline - The CodeBuild Container will need access to codecommit as well
  // Step 2 - Create S3 Bucket for Software TAR Output
  // Step 3 - Create the Build/Lint Pipeline
  // Step 4 - Create the Deploy Pipeline (actually just the last part of the build pipeline after the bucket is outputted)
 
}

function create_image_workflow(scope: Construct, region_name: string, config: any){
  // Step 1 - Create IAM Roles needed - The ImageBuilder EC2 instance will need access to s3 buckets to pull down the tar file mentioned in the software pipeline
  // Step 2 - Create the Code Pipeline and Image Pipeline - Make the image pipeline run stuff from the configs based off of the ami repo config 
  // Step 3 - Write the new ami to the config.json on the infrastructure repo

}

function create_infrastructure_workflow(scope: Construct, region_name: string, config: any){ 

  
  // Step 1 - Create IAM Roles needed - The Codepipeline role will need admin access to deploy the stack in cloudformation
  // Also create the SNS topic/sub and other prerequisites for codepipeline(s)
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
  // Step 2 - Create codepipeline structures and the pipelines
  var infrastructure_pipelines = [] 

  config.infrastructure_site_branches.forEach(function(branch: string) {
    const codepipeline_s3_bucket =  new s3.Bucket(scope, config.stack_name + "-infra-pipeline-storage-" + branch, {
      versioned: true, 
      bucketName: config.stack_name.toLowerCase( ) + "-infra-pipeline-storage-" + branch,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });
  
    const infra_codepipeline = new codepipeline.Pipeline(scope, config.stack_name + "-Infra-Pipeline-" + branch, {
      pipelineName: config.stack_name + "-Infra-Pipeline" + branch,
      artifactBucket: codepipeline_s3_bucket,
      restartExecutionOnUpdate: false,
      role: infra_codepipeline_iam_role
    });

    infrastructure_pipelines.push(infra_codepipeline);

    const infra_pipeline_artifact_src = new codepipeline.Artifact(config.stack_name + "-Infra-PipelineArtifactSource-" + branch);
    const infra_pipeline_artifact_out = new codepipeline.Artifact(config.stack_name + "-Infra-PipelineArtifactOutput-" + branch);
    // Triggers on codecommit commit to the branch specified in the loop 
    const infra_pipeline_src_action = new codepipeline_actions.CodeCommitSourceAction({
      repository: __infrastructure_repo,
      actionName: "SourceAction",
      output: infra_pipeline_artifact_src,
      branch: branch
    });
  
    const infra_pipeline_src = infra_codepipeline.addStage({
      stageName: "Source",
      actions: [infra_pipeline_src_action]
    });
  });



}

export class DevopsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creation of repos is needed first so that the pipelines can trigger eachother
    create_repos(this, config.region, config);
    // The following functions create the overall development workflow
    // Software Pipeline -> Image Pipeline -> Infrastructure Pipeline

    // // Create Software Repo and Pipeline
    // create_software_workflow(this, config.region, config);

    // // Create AMI Repo and Pipeline
    // create_image_workflow(this, config.region, config);

    // // Create Infrastructure Repo and Pipeline
    create_infrastructure_workflow(this, config.region, config);

  }
}
