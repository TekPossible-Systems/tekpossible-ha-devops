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
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as ssm from 'aws-cdk-lib/aws-ssm';

// Globally Accessible Variables - These are the repos that all of the functions need
var __infrastructure_repo: any;
var __image_repo: any;
var __software_repo: any;
var __transition_s3_bucket: any;
var __transition_s3_bucket_parameter: any;
var ssm_repo_parameters = [];
var __image_pipeline_arn_parameter: any;
/* 
General Gameplan for DevOps portion of TekPossible HA Project:
The whole point of this devops repo is to create a workflow in which you can have preconfigured os images software releases, and overall infrastructure configs. 
In order to do this, some considerations need to be made. There needs to be some seperate code repos for this to work. \
1. We need a devops repo that will be the "one ring to rule them all" so to speak. 
2. We need a software repo that will be used by the software developers in order to write and deploy software builds onto our premade infrastructure. 
The hope is to pull the software into a custom AMI, so I will need to have some sort of TAR file premade (hopefully output of the codebuild in the software repo's ci/cd pipeline). 
The end result of this will be committing the software version ID and an s3 bucket location to the AMI repo.
3. Some sort of method to spin up a custom, security approved AMI that is automatically updated before being deployed. The best way to manage an infrastructure is to do some sort of golden image setup, so my plan is to use EC2 image builder. 
I will need to grab the specified software build and install it into the AMI before deeming it as ready. For the security part of this, I also plan on applying the DISA STIG to the images. The end result of this repo will be an AMI and the AMI id will be commited to the below infrastructure repo.
4. We need a infrastructure repo that will be used whenever you want a major infrastucture update. Something like adding a new host into the templated environments. It is less likely to directly update this environment, and instead to update the repos mentioned above.
*/

function create_s3_transition_bucket(scope: Construct, region_name: string, config: any){
  __transition_s3_bucket = new s3.Bucket(scope, config.stack_name + "AWS-S3-Transition-Bucket", {
    bucketName: config.stack_base_name.toLowerCase() + "-s3-bucket",
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
  });
  
  __transition_s3_bucket_parameter = new ssm.StringParameter(scope, config.stack_name + '-AWS-S3-Transition-Parameter', 
  {
    parameterName:  config.stack_base_name.toLowerCase() + '-s3-bucket',
    stringValue: __transition_s3_bucket.bucketName
  });

}

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
      ssm_repo_parameters.push([new ssm.StringParameter(scope, config.stack_name + '-AWS-REPO-Software', 
        {
          parameterName:  config.stack_base_name.toLowerCase() + '-software-repo',
          stringValue: __software_repo.repositoryCloneUrlGrc
        })
      ]);

    } else if (repo.type == "image"){
      __image_repo = tekpossible_repo;
      ssm_repo_parameters.push([new ssm.StringParameter(scope, config.stack_name + '-AWS-REPO-Image', 
        {
          parameterName:  config.stack_base_name.toLowerCase() + '-image-repo',
          stringValue: __image_repo.repositoryCloneUrlGrc
        })
      ]);

    } else if (repo.type == "infrastructure"){
      __infrastructure_repo = tekpossible_repo;
      ssm_repo_parameters.push([new ssm.StringParameter(scope, config.stack_name + '-AWS-REPO-Infrastructure', 
        {
          parameterName:  config.stack_base_name.toLowerCase() + '-infrastructure-repo',
          stringValue: __infrastructure_repo.repositoryCloneUrlGrc
        })
      ]);

    }
  });


}

function create_software_workflow(scope: Construct, region_name: string, config: any){
  // Step 1 - Create IAM Roles needed for the Bucket and Pipeline - The CodeBuild Container will need access to codecommit as well
  const software_codepipeline_iam_role = new iam.Role(scope, config.stack_name + '-SW-CodePipelineRole', {
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
    roleName: config.stack_name + '-SW-CodePipelineRole'

  });
  
  software_codepipeline_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-SW-CodePipelineMP1", "arn:aws:iam::aws:policy/service-role/AWSCodeStarServiceRole"));
  software_codepipeline_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-SW-CodePipelineMP2", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));
  software_codepipeline_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-SW-CodePipelineMP3", "arn:aws:iam::aws:policy/AWSCodeCommitFullAccess"));

  // Step 2 - Create codepipeline structures and the pipelines
  var software_pipelines = [] 

  config.infrastructure_site_branches.forEach(function(branch: string) {
    const codepipeline_s3_bucket =  new s3.Bucket(scope, config.stack_name + "-sw-pipeline-storage-" + branch, {
      versioned: true, 
      bucketName: config.stack_name.toLowerCase( ) + "-sw-pipeline-storage-" + branch,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });
  
    const software_codepipeline = new codepipeline.Pipeline(scope, config.stack_name + "-SW-Pipeline-" + branch, {
      pipelineName: config.stack_name + "-SW-Pipeline-" + branch,
      artifactBucket: codepipeline_s3_bucket,
      restartExecutionOnUpdate: false,
      role: software_codepipeline_iam_role
    });

    software_pipelines.push(software_codepipeline);

    const software_pipeline_artifact_src = new codepipeline.Artifact(config.stack_name + "-SW-PipelineArtifactSource-" + branch);
    const software_pipeline_artifact_out = new codepipeline.Artifact(config.stack_name + "-SW-PipelineArtifactOutput-" + branch);

    // Triggers on codecommit commit to the branch specified in the loop 
    const software_pipeline_src_action = new codepipeline_actions.CodeCommitSourceAction({
      repository: __software_repo,
      actionName: "SourceAction",
      output: software_pipeline_artifact_src,
      branch: branch
    });
  
    const infra_pipeline_src = software_codepipeline.addStage({
      stageName: "Source",
      actions: [software_pipeline_src_action]
    });

    const software_pipeline_codebuild_pre = new codepipeline_actions.CodeBuildAction({ // Codebuild will build the software code, make it into a tar, and then commit the git tag/tar file the image repo
      input: software_pipeline_artifact_src,
      actionName: "CodeBuild",
      project: new codebuild.PipelineProject(scope, config.stack_name + "-codebuild-sw-pre-" + branch, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
          computeType: codebuild.ComputeType.SMALL,
          
        },
        role: software_codepipeline_iam_role
      }),
      outputs: [software_pipeline_artifact_out]
    });

    const software_pipeline_codebuild_pre_stage = software_codepipeline.addStage({
      stageName: "Build",
      actions: [software_pipeline_codebuild_pre]
    });

  });
 
}

function create_image_workflow(scope: Construct, region_name: string, config: any){
  // Step 1 - Create IAM Roles needed - The ImageBuilder EC2 instance will need access to s3 buckets to pull down the tar file mentioned in the software pipeline

  const ec2_imagebuilder_role = new iam.Role(scope, config.stack_name + '-EC2ImageBuilderRole', {
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal("ec2.amazonaws.com"),
      new iam.ServicePrincipal("codecommit.amazonaws.com"),
      new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      new iam.ServicePrincipal("s3.amazonaws.com") 
    ),
    description: "EC2 Image Builder role for CDK Devops Stack"
  });

  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilder"));
  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilderECRContainerBuilds"));
  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-MP1", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));
  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-MP2", "arn:aws:iam::aws:policy/service-role/AWSCodeStarServiceRole"));
  ec2_imagebuilder_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-MP3", "arn:aws:iam::aws:policy/AWSCodeCommitFullAccess"));

  const image_codepipeline_role = new iam.Role(scope, config.stack_name + '-AMI-CodePipelineRole', {
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
    roleName: config.stack_name + '-SW-CodePipelineRole'

  });
  
  image_codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-CPMP1", "arn:aws:iam::aws:policy/service-role/AWSCodeStarServiceRole"));
  image_codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-CPMP2", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));
  image_codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-CPMP3", "arn:aws:iam::aws:policy/aws-service-role/AWSServiceRoleForImageBuilder"));
  image_codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-AMI-CPMP4", "arn:aws:iam::aws:policy/AWSCodeCommitFullAccess"));

  // Step 2 - Create the Image Pipeline - Make the image pipeline run stuff from the configs based off of the ami repo config
  // Create the precursor configs
  const instance_profile = new iam.CfnInstanceProfile(scope, config.stack_name + "-AMIDevopsInstanceProfile", {
      instanceProfileName: config.stack_name + "IAM-EC2IB-InstanceProfile",
      roles: [ec2_imagebuilder_role.roleName]
  });

  const infrastucture_config = new imagebuilder.CfnInfrastructureConfiguration(scope, config.stack_name + "-AMIInfraConfig", {
    name: config.stack_name + config.stack_name + "IAM-EC2IB-InstanceProfile",
    instanceProfileName: String(instance_profile.instanceProfileName),
    instanceTypes: [
      "t2.micro"
    ]
  });

  infrastucture_config.node.addDependency(instance_profile);

  var component_file_data = readFileSync("./assets/ec2-imagebuilder-component.yaml", "utf-8");
  component_file_data.replace("<<AWS_REGION>>", config.region);
  component_file_data.replace("<<IMAGE_REPO_NAME>>", __software_repo.repositoryName);

  const imagebuilder_component = new imagebuilder.CfnComponent(scope, config.stack_name + "-PrimaryComponent", {
    name: "RHEL-Config",
    version: "v1.0.1",
    platform: "Linux",
    data: component_file_data
  });

  const componentConfigurationProperty: imagebuilder.CfnContainerRecipe.ComponentConfigurationProperty = {
    componentArn: imagebuilder_component.attrArn,
  };

  const image_recipe = new imagebuilder.CfnImageRecipe(scope, config.stack_name + "-ImageRecipe", {
    name: config.stack_name + "-ImageRecipe",
    parentImage: config.ami_source_image,
    components: [componentConfigurationProperty],
    version: "1.0.0"
  });

  // create the image pipeline
  const image_pipeline = new imagebuilder.CfnImagePipeline(scope, config.stack_name + "-ImagePipeline", {
    name: config.stack_name + "-ImagePipeline",
    infrastructureConfigurationArn: infrastucture_config.attrArn,
    imageRecipeArn: image_recipe.attrArn,
    // distributionConfigurationArn: "",
    executionRole: ec2_imagebuilder_role.roleArn

  });
  image_pipeline.node.addDependency(infrastucture_config);

  __image_pipeline_arn_parameter = new ssm.StringParameter(scope, config.stack_name + "-ImageBuilderArn-Parameter", {
      parameterName: config.stack_base_name.toLowerCase() + '-imagebuilder-arn',
      stringValue: image_pipeline.attrArn
  });

  // Step 3 - Create the codepipeline the triggers the above pipeline. Not sure how we will determine when the ec2 imagebuilder image is ready but we will need to both trigger and determine the results of the pipeline via awscli (so therefore I will use codebuild to do that)
  var image_pipelines = [];

  config.infrastructure_site_branches.forEach(function(branch: string) {
    const codepipeline_s3_bucket =  new s3.Bucket(scope, config.stack_name + "-ami-pipeline-storage-" + branch, {
      versioned: true, 
      bucketName: config.stack_name.toLowerCase( ) + "-ami-pipeline-storage-" + branch,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });
  
    const image_codepipeline = new codepipeline.Pipeline(scope, config.stack_name + "-AMI-Pipeline-" + branch, {
      pipelineName: config.stack_name + "-AMI-Pipeline-" + branch,
      artifactBucket: codepipeline_s3_bucket,
      restartExecutionOnUpdate: false,
      role: image_codepipeline_role
    });

    image_pipelines.push(image_codepipeline
    );

    const image_codepipeline_artifact_src = new codepipeline.Artifact(config.stack_name + "-AMI-PipelineArtifactSource-" + branch);
    const image_codepipeline_artifact_out = new codepipeline.Artifact(config.stack_name + "-AMI-PipelineArtifactOutput-" + branch);

    // Triggers on codecommit commit to the branch specified in the loop 
    const image_pipeline_src_action = new codepipeline_actions.CodeCommitSourceAction({
      repository: __software_repo,
      actionName: "SourceAction",
      output: image_codepipeline_artifact_src,
      branch: branch
    });
  
    const infra_pipeline_src = image_codepipeline.addStage({
      stageName: "Source",
      actions: [image_pipeline_src_action]
    });

    const image_codepipline_codebuild_pre = new codepipeline_actions.CodeBuildAction({ // Codebuild will build the software code, make it into a tar, and then commit the git tag/tar file the image repo
      input: image_codepipeline_artifact_src,
      actionName: "CodeBuild",
      project: new codebuild.PipelineProject(scope, config.stack_name + "-codebuild-ami-pre-" + branch, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
          computeType: codebuild.ComputeType.SMALL,
          
        },
        role: image_codepipeline_role
      }),
      outputs: [image_codepipeline_artifact_out]
    });

    const software_pipeline_codebuild_pre_stage = image_codepipeline.addStage({
      stageName: "Build",
      actions: [image_codepipline_codebuild_pre]
    });

  });
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
  infra_codepipeline_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-InfraCodePipelineMP1", "arn:aws:iam::aws:policy/AdministratorAccess"));

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
      pipelineName: config.stack_name + "-Infra-Pipeline-" + branch,
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

    const infra_pipeline_codebuild_pre = new codepipeline_actions.CodeBuildAction({
      input: infra_pipeline_artifact_src,
      actionName: "CodeBuild",
      project: new codebuild.PipelineProject(scope, config.stack_name + "-codebuild-infra-pre-" + branch, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
          computeType: codebuild.ComputeType.SMALL,
          
        },
        role: infra_codepipeline_iam_role,
        buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec-pre-approval.yml")
      }),
      outputs: [infra_pipeline_artifact_out]
    });

    const infra_pipeline_codebuild_pre_stage = infra_codepipeline.addStage({
      stageName: "Build",
      actions: [infra_pipeline_codebuild_pre]
    });

    const infra_pipeline_approval_action = new codepipeline_actions.ManualApprovalAction({
      actionName: "DeployApproval",
      notificationTopic: infra_codepipeline_sns_topic
    });
  
    const infra_pipeline_approval_stage = infra_codepipeline.addStage({
      stageName: "DeployApproval",
      actions: [infra_pipeline_approval_action]
    });


    const infra_pipeline_codebuild_post = new codepipeline_actions.CodeBuildAction({
      input: infra_pipeline_artifact_out,
      actionName: "CodeBuild",
      project: new codebuild.PipelineProject(scope, config.stack_name + "-codebuild-infra-post-" + branch, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
          computeType: codebuild.ComputeType.SMALL,
          
        },
        role: infra_codepipeline_iam_role,
        buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec-post-approval.yml")
      })
    });

    const infra_pipeline_codebuild_post_stage = infra_codepipeline.addStage({
      stageName: "Deploy",
      actions: [infra_pipeline_codebuild_post]
    });

  // Pipeline branch loop end  
  });


//Function End
}

export class DevopsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);

  // Creation of repos is needed first so that the pipelines can trigger eachother
    create_repos(this, config.region, config);

  // Creation of transitional s3 bucket to link the pipelines
    create_s3_transition_bucket(this, config.region, config);

  // The following functions create the overall development workflow
  // Software Pipeline -> Image Pipeline -> Infrastructure Pipeline
    create_software_workflow(this, config.region, config);

  // Create AMI Repo and Pipeline
    create_image_workflow(this, config.region, config);

  // Create Infrastructure Repo and Pipeline
    create_infrastructure_workflow(this, config.region, config);

  }
}
