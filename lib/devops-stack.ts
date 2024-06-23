import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Import Contents of Assets folder
import { readFileSync } from 'fs';


// Import CDK Libraries
import * as codecommit from 'aws-cdk-lib/aws-codecommit';

function create_repos(scope: Construct, region_name: string, config: any): codecommit.Repository[] {
  var repo_list: codecommit.Repository[] = [];
  /*
  Format for repo: 
  {
    "name": "Name of the repository",
    "desc": "Description of the repository - human readable summary",
    "type": "Type of the repo - can either be ami, software, infrastructure, or devops"
  }
  
  Note: devops is the only one that does not have a CI/CD Pipeline that does not manage its deployment - that is because it was simpler just to use cdk deploy since it creates the rest of the pipelines
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
    config.repo.forEach(function(temp_repo: any){
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
  // Step 1 - Create IAM Roles needed for the Bucket and Pipeline - The CodeBuild Container will need access to codecommit as well
  // Step 2 - Create S3 Bucket for Software TAR Output
  // Step 3 - Create the Build/Lint Pipeline
  // Step 4 - Create the Deploy Pipeline (actually just the last part of the build pipeline after the bucket is outputted)
  const software_repo = getRepoFromType("software", config, repos);
 
}

function create_image_workflow(scope: Construct, region_name: string, config: any, repos: codecommit.Repository[]){
  // Step 1 - Create IAM Roles needed - The ImageBuilder EC2 instance will need access to s3 buckets to pull down the tar file mentioned in the software pipeline
  // Step 2 - Create the Code Pipeline and Image Pipeline - Make the image pipeline run stuff from the configs based off of the ami repo config 
  // Step 3 - Write the new ami to the config.json on the infrastructure repo
  const software_repo = getRepoFromType("ami", config, repos);

}

function create_infrastructure_workflow(scope: Construct, region_name: string, config: any, repos: codecommit.Repository[]){ 
  // Step 1 - Create IAM Roles needed - The Codepipeline role will need admin access to deploy the stack in cloudformation
  // Step 2 - Create the S3 bucket used to get the synthesized CDK outputs
  // Step 3 - Run codebuild and put the outputs on that s3 bucket
  // Step 4- Use the deploy phase as a cloudformation deploy, based on the s3 bucket contents described above. 
  const software_repo = getRepoFromType("infrastructure", config, repos);

}

export class DevopsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creation of repos is needed first so that the pipelines can trigger eachother
    const repo_list = create_repos(this, config.region, config);

    // The following functions create the overall development workflow
    // Software Pipeline -> Image Pipeline -> Infrastructure Pipeline

    // // Create Software Repo and Pipeline
    // create_software_workflow(scope, config.region, config, repo_list);

    // // Create AMI Repo and Pipeline
    // create_image_workflow(scope, config.region, config, repo_list);

    // // Create Infrastructure Repo and Pipeline
    // create_infrastructure_workflow(scope, config.region, config, repo_list);

  }
}
